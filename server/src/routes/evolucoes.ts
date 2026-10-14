import { Router } from 'express';
import { z } from 'zod';
import { exigir, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import {
  atualizarEvolucao, detalharEvolucao, evolucaoSchema, inserirEvolucao, retrato, validarData, validarFinalizacao,
} from '../lib/evolucoes.js';

export const evolucoesRouter = Router();

export const filtrosHistoricoSchema = z.object({
  assistido_id: z.string().uuid().optional(),
  inicio: dataISO.optional(),
  fim: dataISO.optional(),
  turno: z.enum(['manha', 'tarde']).optional(),
  profissional_id: z.string().uuid().optional(),
  tipo: z.enum(['individual', 'participacao_coletiva']).optional(),
  atividade_id: z.string().uuid().optional(),
  indicador_id: z.string().uuid().optional(),
  status: z.enum(['rascunho', 'finalizada', 'todos']).default('finalizada'),
  limite: z.coerce.number().int().min(1).max(1000).default(200),
});

export function montarFiltros(q: z.infer<typeof filtrosHistoricoSchema>) {
  const cond: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (q.assistido_id) add('e.assistido_id = ?', q.assistido_id);
  if (q.inicio) add('e.data >= ?', q.inicio);
  if (q.fim) add('e.data <= ?', q.fim);
  if (q.turno) add('e.turno = ?', q.turno);
  if (q.profissional_id) add('e.profissional_id = ?', q.profissional_id);
  if (q.tipo) add('e.tipo = ?', q.tipo);
  if (q.atividade_id) add('EXISTS (SELECT 1 FROM evolucao_atividades x WHERE x.evolucao_id = e.id AND x.atividade_id = ?)', q.atividade_id);
  if (q.indicador_id) add('EXISTS (SELECT 1 FROM avaliacoes_indicadores x WHERE x.evolucao_id = e.id AND x.indicador_id = ? AND x.valor IS NOT NULL)', q.indicador_id);
  if (q.status !== 'todos') add('e.status = ?', q.status);
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

evolucoesRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(filtrosHistoricoSchema, req.query);
  const { where, params } = montarFiltros(q);
  params.push(q.limite);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT e.id, e.data, e.horario, e.turno, e.tipo, e.status, e.versao, e.participacao, e.atividade_coletiva_id,
            left(e.texto_evolucao, 220) AS resumo, e.criado_em, e.finalizada_em,
            a.id AS assistido_id, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo,
            u.id AS profissional_id, u.nome AS profissional_nome,
            coalesce((SELECT array_agg(at.nome ORDER BY at.nome) FROM evolucao_atividades ea JOIN atividades at ON at.id = ea.atividade_id
                       WHERE ea.evolucao_id = e.id), '{}') AS atividades,
            (SELECT count(*) FROM avaliacoes_indicadores av WHERE av.evolucao_id = e.id AND av.valor IS NOT NULL)::int AS indicadores_avaliados,
            (SELECT count(*) FROM evolucao_correcoes c WHERE c.evolucao_id = e.id)::int AS correcoes
       FROM evolucoes e JOIN assistidos a ON a.id = e.assistido_id JOIN usuarios u ON u.id = e.profissional_id
       ${where} ORDER BY e.data DESC, e.criado_em DESC LIMIT $${params.length}`, params)).rows);
  res.json(rows);
});

evolucoesRouter.get('/:id', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const d = await tx(req, async (db) => {
    const d = await detalharEvolucao(db, id);
    await auditar(db, req, 'acesso_evolucao', 'evolucao', id, { assistido_id: d.assistido_id });
    return d;
  });
  res.json(d);
});

evolucoesRouter.post('/', exigir('evolucoes.registrar'), async (req, res) => {
  const b = validar(evolucaoSchema.extend({ finalizar: z.boolean().default(false) }), req.body);
  validarData(req, b.data);
  if (b.tipo === 'participacao_coletiva' && !b.participacao) {
    throw new HttpError(400, 'Informe o grau de participação na atividade coletiva.');
  }
  const r = await tx(req, async (db) => {
    const ativo = await db.query('SELECT status FROM assistidos WHERE id = $1', [b.assistido_id]);
    if (!ativo.rowCount) throw new HttpError(404, 'Assistido não encontrado ou sem permissão de acesso.');
    if (ativo.rows[0].status !== 'ativo') throw new HttpError(409, 'Assistido arquivado: reative o cadastro para registrar novos atendimentos.');
    if (b.finalizar) await validarFinalizacao(db, b);
    const id = await inserirEvolucao(db, req, b, b.finalizar);
    await auditar(db, req, b.finalizar ? 'evolucao_finalizada' : 'evolucao_rascunho', 'evolucao', id, { assistido_id: b.assistido_id });
    return { id, status: b.finalizar ? 'finalizada' : 'rascunho' };
  });
  res.status(201).json(r);
});

/** Atualiza um rascunho (e opcionalmente o finaliza). */
evolucoesRouter.put('/:id', exigir('evolucoes.registrar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(evolucaoSchema.extend({ finalizar: z.boolean().default(false) }), req.body);
  const r = await tx(req, async (db) => {
    const atual = await db.query('SELECT status, assistido_id, profissional_id, data, atividade_coletiva_id FROM evolucoes WHERE id = $1', [id]);
    if (!atual.rowCount) throw new HttpError(404, 'Registro não encontrado.');
    const e = atual.rows[0];
    if (e.status === 'finalizada') throw new HttpError(409, 'Registro finalizado. Use "Registrar correção" para alterá-lo.');
    if (e.profissional_id !== req.usuario!.id) throw new HttpError(403, 'Apenas o autor pode editar o rascunho.');
    if (e.atividade_coletiva_id) throw new HttpError(409, 'Este registro pertence a uma atividade em grupo. Edite-o pelo módulo de grupos.');
    if (b.assistido_id !== e.assistido_id) throw new HttpError(400, 'O assistido de um registro não pode ser trocado.');
    if (b.data !== e.data) validarData(req, b.data);
    if (b.finalizar) await validarFinalizacao(db, b);
    await atualizarEvolucao(db, id, b, b.finalizar);
    await auditar(db, req, b.finalizar ? 'evolucao_finalizada' : 'evolucao_rascunho', 'evolucao', id, { assistido_id: e.assistido_id });
    return { id, status: b.finalizar ? 'finalizada' : 'rascunho' };
  });
  res.json(r);
});

evolucoesRouter.delete('/:id', exigir('evolucoes.registrar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  await tx(req, async (db) => {
    const e = await db.query('SELECT status, atividade_coletiva_id, assistido_id FROM evolucoes WHERE id = $1 AND profissional_id = $2', [id, req.usuario!.id]);
    if (!e.rowCount) throw new HttpError(404, 'Rascunho não encontrado.');
    if (e.rows[0].status !== 'rascunho' || e.rows[0].atividade_coletiva_id) throw new HttpError(409, 'Somente rascunhos individuais podem ser descartados.');
    await db.query('DELETE FROM avaliacoes_indicadores WHERE evolucao_id = $1', [id]);
    await db.query('DELETE FROM evolucao_atividades WHERE evolucao_id = $1', [id]);
    await db.query('DELETE FROM evolucoes WHERE id = $1', [id]);
    await auditar(db, req, 'rascunho_descartado', 'evolucao', id, { assistido_id: e.rows[0].assistido_id });
  });
  res.json({ ok: true });
});

/** Correção de registro finalizado: exige motivo e mantém histórico completo (antes/depois). */
evolucoesRouter.post('/:id/correcoes', exigir('evolucoes.corrigir'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(evolucaoSchema.extend({ motivo: z.string().trim().min(5, 'Descreva o motivo da correção (mín. 5 caracteres)') }), req.body);
  const r = await tx(req, async (db) => {
    const antes = await retrato(db, id);
    if (!antes) throw new HttpError(404, 'Registro não encontrado.');
    if (antes.status !== 'finalizada') throw new HttpError(409, 'Rascunhos são editados diretamente.');
    if (b.assistido_id !== antes.assistido_id) throw new HttpError(400, 'O assistido de um registro não pode ser trocado.');
    if (b.data !== antes.data) validarData(req, b.data);
    await validarFinalizacao(db, { ...b, tipo: antes.tipo });
    const c = await db.query(
      `INSERT INTO evolucao_correcoes (evolucao_id, alterado_por, motivo, dados_anteriores) VALUES ($1,$2,$3,$4) RETURNING id`,
      [id, req.usuario!.id, b.motivo, antes]);
    await atualizarEvolucao(db, id, b, true, true);
    const depois = await retrato(db, id);
    await db.query('UPDATE evolucao_correcoes SET dados_novos = $2 WHERE id = $1', [c.rows[0].id, depois]);
    await auditar(db, req, 'evolucao_corrigida', 'evolucao', id, { motivo: b.motivo, versao: depois!.versao });
    return { id, versao: depois!.versao };
  });
  res.json(r);
});
