import { Router } from 'express';
import { z } from 'zod';
import { exigir, tem, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError, calcularIdade, hojeISO } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import { chamarIA } from '../ai/cliente.js';
import { carregarRegistros, contextoAssistido, descreverRegistros, estatisticas, MIN_OBS_TENDENCIA, Pseudonimizador } from '../ai/dados.js';
import { promptRelatorio, promptRelatorioGrupo, SYSTEM_RELATORIO, TIPOS_RELATORIO, VERSAO_PROMPT } from '../ai/prompts.js';
import { gerarPDF } from '../lib/pdf.js';
import type { Db } from '../db/pool.js';

export const relatoriosRouter = Router();

const TIPOS = Object.keys(TIPOS_RELATORIO) as [string, ...string[]];

const criarSchema = z.object({
  tipo: z.enum(TIPOS),
  assistido_id: z.string().uuid().nullish(),
  atividade_coletiva_id: z.string().uuid().nullish(),
  periodo_inicio: dataISO,
  periodo_fim: dataISO,
  objetivo: z.string().trim().max(2000).nullish().transform((v) => v || null),
  registros_ids: z.array(z.string().uuid()).max(500).nullish(),
  incluir_diagnosticos: z.boolean().default(false),
  identificacao: z.enum(['completa', 'codigo']).default('completa'),
  usar_ia: z.boolean().default(true),
  instrucoes: z.string().trim().max(2000).nullish(),
}).superRefine((b, ctx) => {
  if (b.periodo_inicio > b.periodo_fim) ctx.addIssue({ code: 'custom', message: 'Período inválido', path: ['periodo_inicio'] });
  if (b.tipo === 'atividade_grupo' ? !b.atividade_coletiva_id : !b.assistido_id) {
    ctx.addIssue({ code: 'custom', message: b.tipo === 'atividade_grupo' ? 'Selecione a atividade em grupo' : 'Selecione o assistido', path: ['assistido_id'] });
  }
});

type Criar = z.infer<typeof criarSchema>;

const fmt = (d: string) => d.split('-').reverse().join('/');

async function instituicao(db: Db) {
  return (await db.query(`SELECT valor FROM configuracoes WHERE chave = 'instituicao'`)).rows[0]?.valor ?? {};
}

function cabecalho(inst: any, titulo: string, ident: string[], periodo: string) {
  return [
    `# ${titulo}`, '',
    `**${inst.nome || 'Instituição'}**${inst.cnpj ? ` — CNPJ ${inst.cnpj}` : ''}${inst.endereco ? `  \n${inst.endereco}` : ''}`, '',
    '## Identificação', ...ident.map((l) => `- ${l}`), '',
    '## Período analisado', periodo, '',
  ].join('\n');
}

function rodape(nome: string, comIA: boolean) {
  return ['', '---', `Profissional responsável: ${nome}`, `Data de emissão: ${fmt(hojeISO())}`, '',
    comIA
      ? '_Documento elaborado com apoio de ferramenta de IA a partir dos registros institucionais e revisado pelo profissional responsável._'
      : '_Documento elaborado pelo profissional responsável a partir dos registros institucionais._'].join('\n');
}

/** Gera o conteúdo (Markdown) de uma versão — com IA ou um modelo em branco para preenchimento manual. */
async function gerarConteudo(req: any, b: Criar & { instrucoes?: string | null }) {
  const titulo = TIPOS_RELATORIO[b.tipo].titulo;
  const periodo = `${fmt(b.periodo_inicio)} a ${fmt(b.periodo_fim)}`;

  if (b.tipo === 'atividade_grupo') {
    const prep = await tx(req, async (db) => {
      const c = await db.query(`SELECT * FROM atividades_coletivas WHERE id = $1`, [b.atividade_coletiva_id]);
      if (!c.rowCount) throw new HttpError(404, 'Atividade em grupo não encontrada.');
      // Resumo agregado, sem identificação individual (considera os registros visíveis ao usuário).
      const agg = await db.query(
        `SELECT participacao, count(*)::int AS n FROM evolucoes WHERE atividade_coletiva_id = $1 AND status = 'finalizada' GROUP BY participacao`,
        [b.atividade_coletiva_id]);
      return { c: c.rows[0], agg: agg.rows, inst: await instituicao(db), registros: [] as string[] };
    });
    const c = prep.c;
    const ident = [`Atividade: ${c.nome_atividade}`, `Data: ${fmt(c.data)} — ${c.turno === 'manha' ? 'manhã' : 'tarde'}${c.horario ? ` (${c.horario})` : ''}`,
      ...(c.local ? [`Local: ${c.local}`] : [])];
    let corpo: string;
    let modelo: string | null = null;
    if (b.usar_ia) {
      const ps = await tx(req, (db) => Pseudonimizador.criar(db, '\u0000'));
      const resp = await chamarIA({
        system: SYSTEM_RELATORIO, esforco: 'medium',
        prompt: promptRelatorioGrupo({
          objetivo: b.objetivo, resumo: prep.agg,
          coletiva: { nome: c.nome_atividade, objetivo: ps.limpar(c.objetivo), proposta: ps.limpar(c.descricao_proposta), observacoes_gerais: ps.limpar(c.observacoes_gerais), local: ps.limpar(c.local) },
        }) + (b.instrucoes ? `\n\nInstruções adicionais do profissional: ${b.instrucoes}` : ''),
      });
      corpo = resp.texto; modelo = resp.modelo;
    } else {
      corpo = ['## Objetivo do relatório', '', '## Descrição da atividade proposta', '', '## Participação geral do grupo', '', '## Observações gerais', '', '## Pontos para acompanhamento', ''].join('\n');
    }
    return { conteudo: cabecalho(prep.inst, titulo, ident, periodo) + corpo + rodape(req.usuario.nome, b.usar_ia), modelo, registros: [] as string[] };
  }

  const prep = await tx(req, async (db) => {
    const ctx = await contextoAssistido(db, b.assistido_id!, b.incluir_diagnosticos);
    if (!ctx) throw new HttpError(404, 'Assistido não encontrado.');
    const dados = await carregarRegistros(db, b.assistido_id!, b.registros_ids?.length ? b.registros_ids : null, b.periodo_inicio, b.periodo_fim);
    const ps = await Pseudonimizador.criar(db, ctx.a.nome_completo);
    return { ctx, dados, ps, inst: await instituicao(db) };
  });
  if (b.usar_ia && !prep.dados.evolucoes.length) throw new HttpError(400, 'Não há evoluções finalizadas no período/seleção para fundamentar o relatório.');
  const a = prep.ctx.a;
  const ident = b.identificacao === 'completa'
    ? [`Nome: ${a.nome_completo}`, `Código: ${a.codigo}`, `Idade: ${calcularIdade(a.data_nascimento)} anos`]
    : [`Código: ${a.codigo}`];
  if (prep.ctx.diagnosticos.length) ident.push(...prep.ctx.diagnosticos.map((d) => `Diagnóstico registrado: ${d}`));
  ident.push(`Registros considerados: ${prep.dados.evolucoes.length}`);

  let corpo: string;
  let modelo: string | null = null;
  if (b.usar_ia) {
    const resp = await chamarIA({
      system: SYSTEM_RELATORIO, esforco: 'high',
      prompt: promptRelatorio({
        tipo: b.tipo, objetivo: b.objetivo, periodo, idade: prep.ctx.idade, diagnosticos: prep.ctx.diagnosticos,
        estat: estatisticas(prep.dados), registros: descreverRegistros(prep.dados, prep.ps), minObs: MIN_OBS_TENDENCIA,
      }) + (b.instrucoes ? `\n\nInstruções adicionais do profissional: ${b.instrucoes}` : ''),
    });
    // Reidentificação local: o provedor de IA nunca recebe o nome.
    const nomeExib = b.identificacao === 'completa' ? a.nome_completo.split(' ')[0] : a.codigo;
    corpo = resp.texto.replaceAll('[ASSISTIDO]', nomeExib);
    modelo = resp.modelo;
  } else {
    corpo = ['Objetivo do relatório', 'Atividades realizadas', 'Participação e engajamento', 'Evolução dos indicadores',
      'Comportamentos observados', 'Potencialidades e dificuldades', 'Necessidades de apoio identificadas nos registros',
      'Síntese evolutiva', 'Pontos para acompanhamento'].map((s) => `## ${s}\n\n`).join('\n');
  }
  return {
    conteudo: cabecalho(prep.inst, titulo, ident, periodo) + corpo + rodape(req.usuario.nome, b.usar_ia),
    modelo, registros: prep.dados.evolucoes.map((e) => e.id as string),
  };
}

relatoriosRouter.post('/', exigir('relatorios.elaborar'), async (req, res) => {
  const b = validar(criarSchema, req.body);
  if (b.usar_ia && !tem(req, 'ia.gerar')) throw new HttpError(403, 'Sem permissão para gerar textos com IA.');
  const g = await gerarConteudo(req, b);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO relatorios (tipo, assistido_id, atividade_coletiva_id, titulo, objetivo, periodo_inicio, periodo_fim, registros_ids, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.tipo, b.assistido_id ?? null, b.atividade_coletiva_id ?? null, TIPOS_RELATORIO[b.tipo].titulo, b.objetivo,
        b.periodo_inicio, b.periodo_fim, g.registros, req.usuario!.id]);
    const id = r.rows[0].id;
    await db.query(
      `INSERT INTO relatorio_versoes (relatorio_id, numero, origem, conteudo, modelo, versao_prompt, instrucoes, autor_id)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [id, b.usar_ia ? 'ia' : 'profissional', g.conteudo, g.modelo, b.usar_ia ? VERSAO_PROMPT : null,
        JSON.stringify({ incluir_diagnosticos: b.incluir_diagnosticos, identificacao: b.identificacao, instrucoes: b.instrucoes ?? null }), req.usuario!.id]);
    await auditar(db, req, b.usar_ia ? 'relatorio_minuta_ia' : 'relatorio_criado', 'relatorio', id,
      { tipo: b.tipo, assistido_id: b.assistido_id, modelo: g.modelo, registros: g.registros.length });
    return { id };
  });
  res.status(201).json(r);
});

relatoriosRouter.get('/', async (req, res) => {
  if (!tem(req, 'relatorios.elaborar') && !tem(req, 'relatorios.ver_aprovados')) throw new HttpError(403, 'Sem permissão.');
  const q = validar(z.object({ assistido_id: z.string().uuid().optional(), status: z.enum(['minuta', 'aprovado', 'arquivado', 'todos']).default('todos') }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT r.id, r.tipo, r.titulo, r.status, r.periodo_inicio, r.periodo_fim, r.criado_em, r.aprovado_em, r.relatorio_pai_id,
            r.assistido_id, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, r.atividade_coletiva_id,
            c.nome_atividade, u.nome AS criado_por_nome, ap.nome AS aprovado_por_nome,
            (SELECT count(*) FROM relatorio_versoes v WHERE v.relatorio_id = r.id)::int AS versoes
       FROM relatorios r LEFT JOIN assistidos a ON a.id = r.assistido_id LEFT JOIN atividades_coletivas c ON c.id = r.atividade_coletiva_id
       JOIN usuarios u ON u.id = r.criado_por LEFT JOIN usuarios ap ON ap.id = r.aprovado_por
      WHERE ($1::uuid IS NULL OR r.assistido_id = $1) AND ($2 = 'todos' OR r.status = $2)
      ORDER BY r.criado_em DESC LIMIT 300`, [q.assistido_id ?? null, q.status])).rows);
  res.json(rows);
});

relatoriosRouter.get('/:id', async (req, res) => {
  if (!tem(req, 'relatorios.elaborar') && !tem(req, 'relatorios.ver_aprovados')) throw new HttpError(403, 'Sem permissão.');
  const id = validar(z.string().uuid(), req.params.id);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `SELECT r.*, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, u.nome AS criado_por_nome, ap.nome AS aprovado_por_nome
         FROM relatorios r LEFT JOIN assistidos a ON a.id = r.assistido_id JOIN usuarios u ON u.id = r.criado_por
         LEFT JOIN usuarios ap ON ap.id = r.aprovado_por WHERE r.id = $1`, [id]);
    if (!r.rowCount) throw new HttpError(404, 'Relatório não encontrado ou não liberado.');
    const rel = r.rows[0];
    // Perfil de consulta vê somente a versão aprovada.
    const somenteAprovada = !tem(req, 'relatorios.elaborar');
    const versoes = await db.query(
      `SELECT v.id, v.numero, v.origem, v.conteudo, v.modelo, v.versao_prompt, v.instrucoes, v.criado_em, u.nome AS autor_nome
         FROM relatorio_versoes v JOIN usuarios u ON u.id = v.autor_id
        WHERE v.relatorio_id = $1 AND (NOT $2 OR v.id = $3) ORDER BY v.numero DESC`, [id, somenteAprovada, rel.versao_aprovada_id]);
    const registros = somenteAprovada ? [] : (await db.query(
      `SELECT e.id, e.data, e.turno, e.tipo, e.texto_evolucao, u.nome AS profissional_nome FROM evolucoes e JOIN usuarios u ON u.id = e.profissional_id
        WHERE e.id = ANY($1) ORDER BY e.data`, [rel.registros_ids])).rows;
    const anexos = (await db.query(
      `SELECT r.id, r.status, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo FROM relatorios r
         JOIN assistidos a ON a.id = r.assistido_id WHERE r.relatorio_pai_id = $1`, [id])).rows;
    await auditar(db, req, 'acesso_relatorio', 'relatorio', id);
    return { ...rel, versoes: versoes.rows, registros, anexos };
  });
  res.json(r);
});

relatoriosRouter.post('/:id/versoes', exigir('relatorios.elaborar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(z.object({ conteudo: z.string().trim().min(20, 'Conteúdo muito curto').max(200000) }), req.body);
  const r = await tx(req, async (db) => {
    const n = await db.query('SELECT coalesce(max(numero),0)+1 AS n FROM relatorio_versoes WHERE relatorio_id = $1', [id]);
    const r = await db.query(
      `INSERT INTO relatorio_versoes (relatorio_id, numero, origem, conteudo, autor_id) VALUES ($1,$2,'profissional',$3,$4) RETURNING id, numero`,
      [id, n.rows[0].n, b.conteudo, req.usuario!.id]).catch((e) => {
      if (e.code === '42501') throw new HttpError(409, 'Relatório aprovado ou sem permissão de edição.');
      throw e;
    });
    await auditar(db, req, 'relatorio_versao_editada', 'relatorio', id, { numero: r.rows[0].numero });
    return r.rows[0];
  });
  res.status(201).json(r);
});

/** Solicita nova versão à IA, opcionalmente com instruções. */
relatoriosRouter.post('/:id/regenerar', exigir('relatorios.elaborar', 'ia.gerar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const { instrucoes } = validar(z.object({ instrucoes: z.string().trim().max(2000).nullish() }), req.body);
  const rel = await tx(req, async (db) => {
    const r = await db.query('SELECT * FROM relatorios WHERE id = $1', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Relatório não encontrado.');
    if (r.rows[0].status !== 'minuta') throw new HttpError(409, 'Somente minutas podem receber novas versões.');
    const v1 = await db.query('SELECT instrucoes FROM relatorio_versoes WHERE relatorio_id = $1 ORDER BY numero LIMIT 1', [id]);
    return { ...r.rows[0], opcoes: JSON.parse(v1.rows[0]?.instrucoes ?? '{}') };
  });
  const g = await gerarConteudo(req, {
    tipo: rel.tipo, assistido_id: rel.assistido_id, atividade_coletiva_id: rel.atividade_coletiva_id,
    periodo_inicio: rel.periodo_inicio, periodo_fim: rel.periodo_fim, objetivo: rel.objetivo,
    registros_ids: rel.registros_ids, incluir_diagnosticos: !!rel.opcoes.incluir_diagnosticos,
    identificacao: rel.opcoes.identificacao ?? 'completa', usar_ia: true, instrucoes: instrucoes ?? null,
  });
  const r = await tx(req, async (db) => {
    const n = await db.query('SELECT coalesce(max(numero),0)+1 AS n FROM relatorio_versoes WHERE relatorio_id = $1', [id]);
    const r = await db.query(
      `INSERT INTO relatorio_versoes (relatorio_id, numero, origem, conteudo, modelo, versao_prompt, instrucoes, autor_id)
       VALUES ($1,$2,'ia',$3,$4,$5,$6,$7) RETURNING id, numero`,
      [id, n.rows[0].n, g.conteudo, g.modelo, VERSAO_PROMPT, JSON.stringify({ ...rel.opcoes, instrucoes: instrucoes ?? null }), req.usuario!.id]);
    await auditar(db, req, 'relatorio_nova_versao_ia', 'relatorio', id, { numero: r.rows[0].numero, modelo: g.modelo });
    return r.rows[0];
  });
  res.status(201).json(r);
});

relatoriosRouter.post('/:id/aprovar', exigir('relatorios.aprovar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(z.object({ versao_id: z.string().uuid(), confirmo_revisao: z.literal(true, { message: 'Confirme que revisou integralmente o documento' }) }), req.body);
  await tx(req, async (db) => {
    const v = await db.query('SELECT origem, numero FROM relatorio_versoes WHERE id = $1 AND relatorio_id = $2', [b.versao_id, id]);
    if (!v.rowCount) throw new HttpError(404, 'Versão não encontrada.');
    const r = await db.query(
      `UPDATE relatorios SET status = 'aprovado', versao_aprovada_id = $2, aprovado_por = $3, aprovado_em = now()
        WHERE id = $1 AND status = 'minuta'`, [id, b.versao_id, req.usuario!.id]);
    if (!r.rowCount) throw new HttpError(409, 'Relatório já aprovado, arquivado ou sem permissão.');
    await auditar(db, req, 'relatorio_aprovado', 'relatorio', id, { versao: v.rows[0].numero, origem_versao: v.rows[0].origem });
  });
  res.json({ ok: true });
});

relatoriosRouter.post('/:id/arquivar', exigir('relatorios.elaborar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  await tx(req, async (db) => {
    const r = await db.query(`UPDATE relatorios SET status = 'arquivado' WHERE id = $1 AND status = 'minuta'`, [id]);
    if (!r.rowCount) throw new HttpError(409, 'Somente minutas podem ser arquivadas.');
    await auditar(db, req, 'relatorio_arquivado', 'relatorio', id);
  });
  res.json({ ok: true });
});

/** Gera anexos individuais (minutas) para os participantes visíveis de um relatório de grupo. */
relatoriosRouter.post('/:id/anexos', exigir('relatorios.elaborar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const { usar_ia } = validar(z.object({ usar_ia: z.boolean().default(false) }), req.body);
  if (usar_ia && !tem(req, 'ia.gerar')) throw new HttpError(403, 'Sem permissão para gerar textos com IA.');
  const base = await tx(req, async (db) => {
    const r = await db.query('SELECT * FROM relatorios WHERE id = $1 AND tipo = $2', [id, 'atividade_grupo']);
    if (!r.rowCount) throw new HttpError(404, 'Relatório de grupo não encontrado.');
    const ja = new Set((await db.query('SELECT assistido_id FROM relatorios WHERE relatorio_pai_id = $1', [id])).rows.map((x) => x.assistido_id));
    const parts = await db.query(
      `SELECT e.id, e.assistido_id FROM evolucoes e WHERE e.atividade_coletiva_id = $1 AND e.status = 'finalizada'`, [r.rows[0].atividade_coletiva_id]);
    return { rel: r.rows[0], parts: parts.rows.filter((p) => !ja.has(p.assistido_id)) };
  });
  const criados: string[] = [];
  for (const p of base.parts) {
    const g = await gerarConteudo(req, {
      tipo: 'participacao_atividades', assistido_id: p.assistido_id, atividade_coletiva_id: null,
      periodo_inicio: base.rel.periodo_inicio, periodo_fim: base.rel.periodo_fim,
      objetivo: `Anexo individual do relatório de atividade em grupo. ${base.rel.objetivo ?? ''}`.trim(),
      registros_ids: [p.id], incluir_diagnosticos: false, identificacao: 'completa', usar_ia,
    });
    const nid = await tx(req, async (db) => {
      const r = await db.query(
        `INSERT INTO relatorios (tipo, assistido_id, relatorio_pai_id, atividade_coletiva_id, titulo, objetivo, periodo_inicio, periodo_fim, registros_ids, criado_por)
         VALUES ('participacao_atividades',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [p.assistido_id, id, base.rel.atividade_coletiva_id, 'Anexo individual — participação em atividade em grupo', base.rel.objetivo,
          base.rel.periodo_inicio, base.rel.periodo_fim, [p.id], req.usuario!.id]);
      await db.query(
        `INSERT INTO relatorio_versoes (relatorio_id, numero, origem, conteudo, modelo, versao_prompt, instrucoes, autor_id) VALUES ($1,1,$2,$3,$4,$5,$6,$7)`,
        [r.rows[0].id, usar_ia ? 'ia' : 'profissional', g.conteudo, g.modelo, usar_ia ? VERSAO_PROMPT : null,
          JSON.stringify({ identificacao: 'completa' }), req.usuario!.id]);
      await auditar(db, req, 'relatorio_anexo_criado', 'relatorio', r.rows[0].id, { relatorio_pai_id: id });
      return r.rows[0].id;
    });
    criados.push(nid);
  }
  res.status(201).json({ criados: criados.length });
});

relatoriosRouter.get('/:id/pdf', exigir('exportar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const d = await tx(req, async (db) => {
    const r = await db.query(
      `SELECT r.*, v.conteudo, v.numero, v.origem, ap.nome AS aprovado_por_nome FROM relatorios r
         JOIN relatorio_versoes v ON v.id = r.versao_aprovada_id JOIN usuarios ap ON ap.id = r.aprovado_por
        WHERE r.id = $1 AND r.status = 'aprovado'`, [id]);
    if (!r.rowCount) throw new HttpError(409, 'Somente relatórios aprovados podem ser exportados.');
    await auditar(db, req, 'exportacao_pdf', 'relatorio', id, { versao: r.rows[0].numero });
    return r.rows[0];
  });
  const pdf = await gerarPDF(d.conteudo, {
    rodape: `Versão ${d.numero} aprovada por ${d.aprovado_por_nome} em ${new Date(d.aprovado_em).toLocaleString('pt-BR')} — documento confidencial`,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${d.id.slice(0, 8)}.pdf"`);
  res.send(pdf);
});
