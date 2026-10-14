import { Router } from 'express';
import { z } from 'zod';
import { exigir, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError, normalizarNome } from '../lib/util.js';
import { dataISO, textoOpc, turno, validar } from '../lib/validacao.js';
import { atualizarEvolucao, conteudoEvolucaoSchema, detalharEvolucao, inserirEvolucao, validarData, validarFinalizacao } from '../lib/evolucoes.js';
import type { Db } from '../db/pool.js';

export const coletivasRouter = Router();

const participanteSchema = z.object({
  assistido_id: z.string().uuid(),
  situacao: z.enum(['participante', 'previsto_ausente']),
  motivo_ausencia: textoOpc,
  revisado: z.boolean().default(false),       // confirmação individual pelo profissional
  registro: conteudoEvolucaoSchema.optional(),
});

const coletivaSchema = z.object({
  data: dataISO,
  horario: z.string().trim().max(40).nullish().transform((v) => v || null),
  turno,
  atividade_id: z.string().uuid().nullish().transform((v) => v ?? null),
  nome_atividade: z.string().trim().min(2, 'Informe o nome da atividade').max(200),
  local: z.string().trim().max(200).nullish().transform((v) => v || null),
  objetivo: textoOpc,
  descricao_proposta: textoOpc,
  observacoes_gerais: textoOpc,
  participantes: z.array(participanteSchema).max(80).default([]),
  finalizar: z.boolean().default(false),
}).superRefine((c, ctx) => {
  const ids = c.participantes.map((p) => p.assistido_id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Assistido repetido na lista', path: ['participantes'] });
});

type Coletiva = z.infer<typeof coletivaSchema>;

function validarFinalizacaoGrupo(c: Coletiva) {
  const erros: { campo: string; mensagem: string }[] = [];
  const presentes = c.participantes.filter((p) => p.situacao === 'participante');
  if (!presentes.length) erros.push({ campo: 'participantes', mensagem: 'Inclua ao menos um participante.' });
  const textos = new Map<string, string>();
  for (const p of presentes) {
    const campo = `participantes.${p.assistido_id}`;
    if (!p.revisado) erros.push({ campo, mensagem: 'Revise e confirme o registro individual deste participante.' });
    if (!p.registro?.participacao) erros.push({ campo, mensagem: 'Informe se participou integralmente, parcialmente ou não participou.' });
    const t = p.registro?.texto_evolucao ? normalizarNome(p.registro.texto_evolucao) : '';
    // Regra essencial: cada pessoa tem seu próprio registro — evoluções idênticas não são aceitas.
    if (t && textos.has(t)) {
      erros.push({ campo, mensagem: 'Evolução individual idêntica à de outro participante. Descreva o que foi observado nesta pessoa.' });
    }
    if (t) textos.set(t, p.assistido_id);
  }
  if (erros.length) throw new HttpError(400, 'Complete os registros individuais antes de finalizar a atividade.', erros);
}

async function sincronizar(db: Db, req: any, coletivaId: string, c: Coletiva) {
  const existentes = await db.query(
    `SELECT cp.assistido_id, e.id AS evolucao_id FROM coletiva_participantes cp
       LEFT JOIN evolucoes e ON e.atividade_coletiva_id = cp.atividade_coletiva_id AND e.assistido_id = cp.assistido_id
      WHERE cp.atividade_coletiva_id = $1`, [coletivaId]);
  const mapa = new Map(existentes.rows.map((r) => [r.assistido_id, r.evolucao_id as string | null]));
  const novos = new Set(c.participantes.map((p) => p.assistido_id));
  // Remove quem saiu da lista (apenas rascunhos).
  for (const [aid, eid] of mapa) {
    if (novos.has(aid)) continue;
    if (eid) await descartarEvolucao(db, eid);
    await db.query('DELETE FROM coletiva_participantes WHERE atividade_coletiva_id = $1 AND assistido_id = $2', [coletivaId, aid]);
  }
  for (const p of c.participantes) {
    const ok = await db.query('SELECT status FROM assistidos WHERE id = $1', [p.assistido_id]);
    if (!ok.rowCount) throw new HttpError(403, 'Participante sem permissão de acesso.');
    await db.query(
      `INSERT INTO coletiva_participantes (atividade_coletiva_id, assistido_id, situacao, motivo_ausencia) VALUES ($1,$2,$3,$4)
       ON CONFLICT (atividade_coletiva_id, assistido_id) DO UPDATE SET situacao = EXCLUDED.situacao, motivo_ausencia = EXCLUDED.motivo_ausencia`,
      [coletivaId, p.assistido_id, p.situacao, p.situacao === 'previsto_ausente' ? p.motivo_ausencia : null]);
    const eid = mapa.get(p.assistido_id) ?? null;
    if (p.situacao === 'previsto_ausente') {
      if (eid) await descartarEvolucao(db, eid);
      continue;
    }
    const reg = p.registro ?? conteudoEvolucaoSchema.parse({});
    // A atividade do grupo é vinculada automaticamente; o grau de realização acompanha a participação.
    const atividades = c.atividade_id && !reg.atividades.some((a) => a.atividade_id === c.atividade_id)
      ? [{ atividade_id: c.atividade_id, realizacao: reg.participacao }, ...reg.atividades]
      : reg.atividades;
    const payload = {
      ...reg, atividades, assistido_id: p.assistido_id, data: c.data, horario: c.horario, turno: c.turno,
      tipo: 'participacao_coletiva' as const, duracao_minutos: null, local: c.local,
      participacao: reg.participacao ?? 'integral',
    };
    if (eid) await atualizarEvolucao(db, eid, payload, c.finalizar);
    else await inserirEvolucao(db, req, { ...payload, atividade_coletiva_id: coletivaId }, c.finalizar);
  }
}

async function descartarEvolucao(db: Db, eid: string) {
  await db.query('DELETE FROM avaliacoes_indicadores WHERE evolucao_id = $1', [eid]);
  await db.query('DELETE FROM evolucao_atividades WHERE evolucao_id = $1', [eid]);
  const r = await db.query(`DELETE FROM evolucoes WHERE id = $1 AND status = 'rascunho'`, [eid]);
  if (!r.rowCount) throw new HttpError(409, 'Registro individual já finalizado não pode ser removido.');
}

coletivasRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(z.object({ inicio: dataISO.optional(), fim: dataISO.optional(), turno: turno.optional(),
    status: z.enum(['rascunho', 'finalizada', 'todos']).default('todos') }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT c.id, c.data, c.horario, c.turno, c.nome_atividade, c.local, c.status, c.profissional_id, u.nome AS profissional_nome,
            (SELECT count(*) FROM coletiva_participantes p WHERE p.atividade_coletiva_id = c.id AND p.situacao = 'participante')::int AS participantes_visiveis,
            (SELECT count(*) FROM coletiva_participantes p WHERE p.atividade_coletiva_id = c.id AND p.situacao = 'previsto_ausente')::int AS ausentes_visiveis
       FROM atividades_coletivas c JOIN usuarios u ON u.id = c.profissional_id
      WHERE ($1::date IS NULL OR c.data >= $1) AND ($2::date IS NULL OR c.data <= $2) AND ($3::turno IS NULL OR c.turno = $3)
        AND ($4 = 'todos' OR c.status::text = $4)
      ORDER BY c.data DESC, c.criado_em DESC LIMIT 300`, [q.inicio ?? null, q.fim ?? null, q.turno ?? null, q.status])).rows);
  res.json(rows);
});

coletivasRouter.get('/:id', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const r = await tx(req, async (db) => {
    const c = await db.query(
      `SELECT c.*, u.nome AS profissional_nome FROM atividades_coletivas c JOIN usuarios u ON u.id = c.profissional_id WHERE c.id = $1`, [id]);
    if (!c.rowCount) throw new HttpError(404, 'Atividade em grupo não encontrada.');
    // Participantes filtrados por RLS: cada usuário só vê os assistidos aos quais tem acesso.
    const parts = await db.query(
      `SELECT p.assistido_id, p.situacao, p.motivo_ausencia, a.nome_completo, a.codigo, e.id AS evolucao_id
         FROM coletiva_participantes p JOIN assistidos a ON a.id = p.assistido_id
         LEFT JOIN evolucoes e ON e.atividade_coletiva_id = p.atividade_coletiva_id AND e.assistido_id = p.assistido_id
        WHERE p.atividade_coletiva_id = $1 ORDER BY a.nome_busca`, [id]);
    const total = await db.query(`SELECT count(*)::int AS n FROM evolucoes WHERE atividade_coletiva_id = $1`, [id]);
    const participantes = [];
    for (const p of parts.rows) {
      participantes.push({ ...p, registro: p.evolucao_id ? await detalharEvolucao(db, p.evolucao_id).catch(() => null) : null });
    }
    await auditar(db, req, 'acesso_atividade_coletiva', 'atividade_coletiva', id, { participantes_visiveis: participantes.length });
    return { ...c.rows[0], participantes, registros_visiveis: total.rows[0].n };
  });
  res.json(r);
});

coletivasRouter.post('/', exigir('coletivas.registrar', 'evolucoes.registrar'), async (req, res) => {
  const c = validar(coletivaSchema, req.body);
  validarData(req, c.data);
  if (c.finalizar) {
    validarFinalizacaoGrupo(c);
  }
  const r = await tx(req, async (db) => {
    if (c.finalizar) for (const p of c.participantes.filter((x) => x.situacao === 'participante')) await validarFinalizacao(db, { ...p.registro!, tipo: 'participacao_coletiva' });
    const ins = await db.query(
      `INSERT INTO atividades_coletivas (data, horario, turno, profissional_id, atividade_id, nome_atividade, local, objetivo,
          descricao_proposta, observacoes_gerais)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [c.data, c.horario, c.turno, req.usuario!.id, c.atividade_id, c.nome_atividade, c.local, c.objetivo, c.descricao_proposta,
        c.observacoes_gerais]);
    const id = ins.rows[0].id;
    await sincronizar(db, req, id, c);
    if (c.finalizar) await db.query(`UPDATE atividades_coletivas SET status = 'finalizada', finalizada_em = now() WHERE id = $1`, [id]);
    await auditar(db, req, c.finalizar ? 'coletiva_finalizada' : 'coletiva_rascunho', 'atividade_coletiva', id,
      { participantes: c.participantes.length });
    return { id, status: c.finalizar ? 'finalizada' : 'rascunho' };
  });
  res.status(201).json(r);
});

coletivasRouter.put('/:id', exigir('coletivas.registrar', 'evolucoes.registrar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const c = validar(coletivaSchema, req.body);
  const r = await tx(req, async (db) => {
    const atual = await db.query('SELECT status, profissional_id, data FROM atividades_coletivas WHERE id = $1', [id]);
    if (!atual.rowCount) throw new HttpError(404, 'Atividade em grupo não encontrada.');
    if (atual.rows[0].status === 'finalizada') {
      throw new HttpError(409, 'Atividade já finalizada. Correções individuais devem ser feitas em cada registro.');
    }
    if (atual.rows[0].profissional_id !== req.usuario!.id) throw new HttpError(403, 'Apenas o profissional responsável pode editar este registro.');
    if (c.data !== atual.rows[0].data) validarData(req, c.data);
    if (c.finalizar) {
      validarFinalizacaoGrupo(c);
      for (const p of c.participantes.filter((x) => x.situacao === 'participante')) await validarFinalizacao(db, { ...p.registro!, tipo: 'participacao_coletiva' });
    }
    const u = await db.query(
      `UPDATE atividades_coletivas SET data=$2, horario=$3, turno=$4, atividade_id=$5, nome_atividade=$6, local=$7, objetivo=$8,
          descricao_proposta=$9, observacoes_gerais=$10, atualizado_em=now() WHERE id=$1`,
      [id, c.data, c.horario, c.turno, c.atividade_id, c.nome_atividade, c.local, c.objetivo, c.descricao_proposta, c.observacoes_gerais]);
    if (!u.rowCount) throw new HttpError(403, 'Sem permissão para editar.');
    await sincronizar(db, req, id, c);
    if (c.finalizar) await db.query(`UPDATE atividades_coletivas SET status = 'finalizada', finalizada_em = now() WHERE id = $1`, [id]);
    await auditar(db, req, c.finalizar ? 'coletiva_finalizada' : 'coletiva_rascunho', 'atividade_coletiva', id,
      { participantes: c.participantes.length });
    return { id, status: c.finalizar ? 'finalizada' : 'rascunho' };
  });
  res.json(r);
});
