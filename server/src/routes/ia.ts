import { Router } from 'express';
import { z } from 'zod';
import { exigir, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import { chamarIA, descricaoProvedor, iaDisponivel } from '../ai/cliente.js';
import { carregarRegistros, contextoAssistido, descreverRegistros, estatisticas, MIN_OBS_TENDENCIA, Pseudonimizador } from '../ai/dados.js';
import {
  ESQUEMA_ANALISE_EVOLUCAO, ESQUEMA_ANALISE_LONGITUDINAL, promptAnaliseEvolucao, promptAnaliseLongitudinal, SYSTEM_ANALISE, VERSAO_PROMPT,
} from '../ai/prompts.js';
import type { Db } from '../db/pool.js';

export const iaRouter = Router();

async function iaHabilitadaNaInstituicao(db: Db) {
  const r = await db.query(`SELECT valor FROM configuracoes WHERE chave = 'ia'`);
  if (r.rows[0]?.valor?.habilitada === false) throw new HttpError(403, 'O uso de IA está desabilitado nas configurações da instituição.');
}

iaRouter.get('/status', async (_req, res) => {
  res.json({ disponivel: iaDisponivel(), ...(descricaoProvedor() ?? {}) });
});

function parseJSON(texto: string) {
  try {
    return JSON.parse(texto);
  } catch {
    throw new HttpError(502, 'Resposta da IA em formato inesperado. Tente novamente.');
  }
}

iaRouter.post('/analises/evolucao', exigir('ia.gerar'), async (req, res) => {
  const b = validar(z.object({ evolucao_id: z.string().uuid(), incluir_diagnosticos: z.boolean().default(false) }), req.body);
  // Etapa 1: leitura e pseudonimização (transação curta).
  const prep = await tx(req, async (db) => {
    await iaHabilitadaNaInstituicao(db);
    const e = await db.query('SELECT id, assistido_id, status FROM evolucoes WHERE id = $1', [b.evolucao_id]);
    if (!e.rowCount) throw new HttpError(404, 'Registro não encontrado.');
    if (e.rows[0].status !== 'finalizada') throw new HttpError(409, 'Salve a evolução (finalizada) antes de gerar a análise com IA.');
    const ctx = (await contextoAssistido(db, e.rows[0].assistido_id, b.incluir_diagnosticos))!;
    const ps = await Pseudonimizador.criar(db, ctx.a.nome_completo);
    const dados = await carregarRegistros(db, ctx.a.id, [b.evolucao_id]);
    return { ctx, texto: descreverRegistros(dados, ps), assistidoId: ctx.a.id };
  });
  // Etapa 2: chamada externa fora da transação.
  const resp = await chamarIA({ system: SYSTEM_ANALISE, prompt: promptAnaliseEvolucao(prep.ctx, prep.texto), esquemaJSON: ESQUEMA_ANALISE_EVOLUCAO, esforco: 'medium' });
  const conteudo = parseJSON(resp.texto);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO analises_ia (tipo, assistido_id, evolucao_id, registros_ids, modelo, versao_prompt, conteudo_ia, gerado_por)
       VALUES ('evolucao',$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [prep.assistidoId, b.evolucao_id, [b.evolucao_id], resp.modelo, VERSAO_PROMPT,
        { analise: conteudo, incluiu_diagnosticos: b.incluir_diagnosticos, uso: { entrada: resp.tokensEntrada, saida: resp.tokensSaida } },
        req.usuario!.id]);
    await auditar(db, req, 'ia_analise_evolucao', 'analise_ia', r.rows[0].id,
      { evolucao_id: b.evolucao_id, modelo: resp.modelo, incluiu_diagnosticos: b.incluir_diagnosticos, dados_pseudonimizados: true });
    return r.rows[0];
  });
  res.status(201).json(r);
});

iaRouter.post('/analises/longitudinal', exigir('ia.gerar'), async (req, res) => {
  const b = validar(z.object({
    assistido_id: z.string().uuid(), inicio: dataISO, fim: dataISO, incluir_diagnosticos: z.boolean().default(false),
  }).refine((x) => x.inicio <= x.fim, { message: 'Período inválido', path: ['inicio'] }), req.body);
  const prep = await tx(req, async (db) => {
    await iaHabilitadaNaInstituicao(db);
    const ctx = await contextoAssistido(db, b.assistido_id, b.incluir_diagnosticos);
    if (!ctx) throw new HttpError(404, 'Assistido não encontrado.');
    const dados = await carregarRegistros(db, b.assistido_id, null, b.inicio, b.fim);
    if (!dados.evolucoes.length) throw new HttpError(400, 'Não há evoluções finalizadas no período selecionado.');
    const ps = await Pseudonimizador.criar(db, ctx.a.nome_completo);
    return { ctx, dados, texto: descreverRegistros(dados, ps), estat: estatisticas(dados) };
  });
  const periodo = `${b.inicio} a ${b.fim}`;
  const resp = await chamarIA({
    system: SYSTEM_ANALISE, esquemaJSON: ESQUEMA_ANALISE_LONGITUDINAL, esforco: 'high',
    prompt: promptAnaliseLongitudinal(prep.ctx, periodo, prep.estat, prep.texto, MIN_OBS_TENDENCIA),
  });
  const conteudo = parseJSON(resp.texto);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO analises_ia (tipo, assistido_id, periodo_inicio, periodo_fim, registros_ids, modelo, versao_prompt, conteudo_ia, gerado_por)
       VALUES ('longitudinal',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.assistido_id, b.inicio, b.fim, prep.dados.evolucoes.map((e) => e.id), resp.modelo, VERSAO_PROMPT,
        { analise: conteudo, estatisticas: prep.estat, incluiu_diagnosticos: b.incluir_diagnosticos, uso: { entrada: resp.tokensEntrada, saida: resp.tokensSaida } },
        req.usuario!.id]);
    await auditar(db, req, 'ia_analise_longitudinal', 'analise_ia', r.rows[0].id,
      { assistido_id: b.assistido_id, registros: prep.dados.evolucoes.length, modelo: resp.modelo, dados_pseudonimizados: true });
    return r.rows[0];
  });
  res.status(201).json(r);
});

iaRouter.get('/analises', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(z.object({ assistido_id: z.string().uuid().optional() }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT x.id, x.tipo, x.assistido_id, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, x.evolucao_id,
            x.periodo_inicio, x.periodo_fim, x.status, x.modelo, x.gerado_em, u.nome AS gerado_por_nome, x.revisado_em,
            cardinality(x.registros_ids) AS n_registros
       FROM analises_ia x JOIN assistidos a ON a.id = x.assistido_id JOIN usuarios u ON u.id = x.gerado_por
      WHERE ($1::uuid IS NULL OR x.assistido_id = $1) ORDER BY x.gerado_em DESC LIMIT 200`, [q.assistido_id ?? null])).rows);
  res.json(rows);
});

iaRouter.get('/analises/:id', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `SELECT x.*, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, u.nome AS gerado_por_nome, rv.nome AS revisado_por_nome
         FROM analises_ia x JOIN assistidos a ON a.id = x.assistido_id JOIN usuarios u ON u.id = x.gerado_por
         LEFT JOIN usuarios rv ON rv.id = x.revisado_por WHERE x.id = $1`, [id]);
    if (!r.rowCount) throw new HttpError(404, 'Análise não encontrada.');
    const regs = await db.query(
      `SELECT e.id, e.data, e.turno, e.tipo, e.texto_evolucao FROM evolucoes e WHERE e.id = ANY($1) ORDER BY e.data`, [r.rows[0].registros_ids]);
    await auditar(db, req, 'acesso_analise_ia', 'analise_ia', id);
    return { ...r.rows[0], registros: regs.rows };
  });
  res.json(r);
});

/** Revisão humana obrigatória: o profissional edita e aprova (ou descarta) a minuta. */
iaRouter.put('/analises/:id', exigir('ia.gerar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(z.object({
    status: z.enum(['revisada', 'descartada']),
    texto_revisado: z.string().trim().max(50000).nullish(),
  }).refine((x) => x.status === 'descartada' || (x.texto_revisado && x.texto_revisado.length >= 10),
    { message: 'Informe o texto revisado', path: ['texto_revisado'] }), req.body);
  await tx(req, async (db) => {
    const r = await db.query(
      `UPDATE analises_ia SET status = $2, texto_revisado = $3, revisado_por = $4, revisado_em = now()
        WHERE id = $1 AND status = 'minuta'`, [id, b.status, b.texto_revisado ?? null, req.usuario!.id]);
    if (!r.rowCount) throw new HttpError(409, 'Análise já revisada ou sem permissão.');
    await auditar(db, req, b.status === 'revisada' ? 'ia_analise_revisada' : 'ia_analise_descartada', 'analise_ia', id);
  });
  res.json({ ok: true });
});
