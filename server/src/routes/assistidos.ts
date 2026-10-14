import { Router } from 'express';
import { z } from 'zod';
import { exigir, tem, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError, calcularIdade, cifrar, decifrar, normalizarNome } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import type { Db } from '../db/pool.js';

export const assistidosRouter = Router();

const diagnosticoSchema = z.object({
  descricao: z.string().trim().min(2, 'Informe a descrição'),
  cid_codigo: z.string().trim().toUpperCase().nullish().transform((v) => v || null),
  situacao: z.enum(['documentado_prontuario', 'pendente_documentacao']).default('pendente_documentacao'),
  fonte_documental: z.string().trim().max(500).nullish().transform((v) => v || null),
});

const assistidoSchema = z.object({
  nome_completo: z.string().trim().min(3, 'Informe o nome completo').max(200),
  data_nascimento: dataISO.refine((v) => v <= new Date().toISOString().slice(0, 10), 'Data no futuro'),
  turno_habitual: z.enum(['manha', 'tarde', 'ambos']),
  dias_atendimento: z.array(z.number().int().min(1).max(6)).max(6).default([]),
  diagnosticos: z.array(diagnosticoSchema).max(30).default([]),
  observacoes_restritas: z.string().max(10000).nullish(),
});

function formatar(a: any, incluirRestritas: boolean) {
  return {
    id: a.id, codigo: a.codigo, nome_completo: a.nome_completo, data_nascimento: a.data_nascimento,
    idade: calcularIdade(a.data_nascimento), turno_habitual: a.turno_habitual, status: a.status,
    exemplo: a.exemplo, criado_em: a.criado_em, criado_por_nome: a.criado_por_nome,
    atualizado_em: a.atualizado_em, arquivado_em: a.arquivado_em, anonimizado_em: a.anonimizado_em,
    dias_atendimento: a.dias_atendimento ?? [],
    ...(incluirRestritas ? { observacoes_restritas: decifrar(a.observacoes_restritas_cifradas) } : {}),
    possui_observacoes_restritas: !!a.observacoes_restritas_cifradas,
  };
}

const SELECT_BASE = `
  SELECT a.*, u.nome AS criado_por_nome,
    coalesce((SELECT array_agg(dia_semana ORDER BY dia_semana) FROM assistido_agenda g WHERE g.assistido_id = a.id), '{}') AS dias_atendimento
  FROM assistidos a JOIN usuarios u ON u.id = a.criado_por`;

assistidosRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(z.object({
    busca: z.string().trim().max(100).optional(),
    turno: z.enum(['manha', 'tarde', 'ambos']).optional(),
    dia: z.coerce.number().int().min(1).max(6).optional(),
    status: z.enum(['ativo', 'arquivado', 'todos']).default('ativo'),
  }), req.query);
  const cond: string[] = [];
  const params: unknown[] = [];
  if (q.busca) {
    params.push(`%${normalizarNome(q.busca)}%`, q.busca.toUpperCase());
    cond.push(`(a.nome_busca LIKE $${params.length - 1} OR a.codigo = $${params.length})`);
  }
  if (q.turno) {
    params.push(q.turno);
    cond.push(q.turno === 'ambos' ? `a.turno_habitual = $${params.length}` : `a.turno_habitual IN ($${params.length}, 'ambos')`);
  }
  if (q.dia) { params.push(q.dia); cond.push(`EXISTS (SELECT 1 FROM assistido_agenda g WHERE g.assistido_id = a.id AND g.dia_semana = $${params.length})`); }
  if (q.status !== 'todos') { params.push(q.status); cond.push(`a.status = $${params.length}`); }
  const rows = await tx(req, async (db) =>
    (await db.query(`${SELECT_BASE} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.nome_busca LIMIT 500`, params)).rows);
  res.json(rows.map((a) => formatar(a, false)));
});

/** Verifica possíveis duplicidades antes do cadastro. */
assistidosRouter.get('/verificar-duplicidade', exigir('assistidos.editar'), async (req, res) => {
  const q = validar(z.object({ nome: z.string().trim().min(3), data_nascimento: dataISO.optional(), ignorar: z.string().uuid().optional() }), req.query);
  const nome = normalizarNome(q.nome);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT id, codigo, nome_completo, data_nascimento, status FROM assistidos
      WHERE anonimizado_em IS NULL AND ($3::uuid IS NULL OR id <> $3)
        AND (nome_busca = $1 OR ($2::date IS NOT NULL AND data_nascimento = $2 AND split_part(nome_busca, ' ', 1) = split_part($1, ' ', 1)))
      LIMIT 10`, [nome, q.data_nascimento ?? null, q.ignorar ?? null])).rows);
  res.json(rows);
});

async function carregar(db: Db, id: string) {
  const r = await db.query(`${SELECT_BASE} WHERE a.id = $1`, [id]);
  if (!r.rowCount) throw new HttpError(404, 'Assistido não encontrado ou sem permissão de acesso.');
  const diags = await db.query(
    `SELECT d.id, d.descricao, d.cid_codigo, c.descricao AS cid_descricao, d.situacao, d.fonte_documental, d.criado_em, u.nome AS criado_por_nome
       FROM assistido_diagnosticos d LEFT JOIN cid_codigos c ON c.codigo = d.cid_codigo JOIN usuarios u ON u.id = d.criado_por
      WHERE d.assistido_id = $1 ORDER BY d.criado_em`, [id]);
  return { a: r.rows[0], diagnosticos: diags.rows };
}

assistidosRouter.get('/:id', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const restritas = tem(req, 'assistidos.observacoes_restritas');
  const dados = await tx(req, async (db) => {
    const d = await carregar(db, id);
    await auditar(db, req, 'acesso_assistido', 'assistido', id, { observacoes_restritas: restritas && !!d.a.observacoes_restritas_cifradas });
    return d;
  });
  res.json({ ...formatar(dados.a, restritas), diagnosticos: dados.diagnosticos });
});

async function salvarDiagnosticos(db: Db, req: any, assistidoId: string, diagnosticos: z.infer<typeof diagnosticoSchema>[]) {
  await db.query('DELETE FROM assistido_diagnosticos WHERE assistido_id = $1', [assistidoId]);
  for (const d of diagnosticos) {
    if (d.cid_codigo) {
      const existe = await db.query('SELECT 1 FROM cid_codigos WHERE codigo = $1', [d.cid_codigo]);
      if (!existe.rowCount) throw new HttpError(400, `Código CID ${d.cid_codigo} não está no catálogo. Cadastre-o antes (requer autorização).`);
    }
    await db.query(
      `INSERT INTO assistido_diagnosticos (assistido_id, descricao, cid_codigo, situacao, fonte_documental, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [assistidoId, d.descricao, d.cid_codigo, d.situacao, d.fonte_documental, req.usuario.id]);
  }
}

async function salvarAgenda(db: Db, assistidoId: string, dias: number[]) {
  await db.query('DELETE FROM assistido_agenda WHERE assistido_id = $1', [assistidoId]);
  for (const d of [...new Set(dias)]) await db.query('INSERT INTO assistido_agenda VALUES ($1,$2)', [assistidoId, d]);
}

assistidosRouter.post('/', exigir('assistidos.editar'), async (req, res) => {
  const b = validar(assistidoSchema, req.body);
  if (b.observacoes_restritas && !tem(req, 'assistidos.observacoes_restritas')) {
    throw new HttpError(403, 'Sem permissão para registrar observações restritas.');
  }
  const criado = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO assistidos (nome_completo, nome_busca, data_nascimento, turno_habitual, observacoes_restritas_cifradas, criado_por, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id, codigo`,
      [b.nome_completo, normalizarNome(b.nome_completo), b.data_nascimento, b.turno_habitual, cifrar(b.observacoes_restritas), req.usuario!.id]);
    const { id } = r.rows[0];
    await salvarAgenda(db, id, b.dias_atendimento);
    await salvarDiagnosticos(db, req, id, b.diagnosticos);
    await auditar(db, req, 'assistido_criado', 'assistido', id, { codigo: r.rows[0].codigo });
    return r.rows[0];
  });
  res.status(201).json(criado);
});

assistidosRouter.put('/:id', exigir('assistidos.editar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(assistidoSchema.extend({ manter_observacoes_restritas: z.boolean().default(false) }), req.body);
  const podeRestritas = tem(req, 'assistidos.observacoes_restritas');
  if (!podeRestritas && !b.manter_observacoes_restritas) b.manter_observacoes_restritas = true;
  await tx(req, async (db) => {
    const atual = await carregar(db, id);
    if (atual.a.anonimizado_em) throw new HttpError(409, 'Cadastro anonimizado não pode ser editado.');
    const obs = b.manter_observacoes_restritas ? atual.a.observacoes_restritas_cifradas : cifrar(b.observacoes_restritas);
    const r = await db.query(
      `UPDATE assistidos SET nome_completo = $2, nome_busca = $3, data_nascimento = $4, turno_habitual = $5,
          observacoes_restritas_cifradas = $6, atualizado_em = now(), atualizado_por = $7 WHERE id = $1`,
      [id, b.nome_completo, normalizarNome(b.nome_completo), b.data_nascimento, b.turno_habitual, obs, req.usuario!.id]);
    if (!r.rowCount) throw new HttpError(403, 'Sem permissão para editar este cadastro.');
    await salvarAgenda(db, id, b.dias_atendimento);
    await salvarDiagnosticos(db, req, id, b.diagnosticos);
    const alterados = ['nome_completo', 'data_nascimento', 'turno_habitual'].filter((k) => String(atual.a[k]) !== String((b as any)[k]));
    await auditar(db, req, 'assistido_atualizado', 'assistido', id, {
      campos_alterados: alterados, anteriores: Object.fromEntries(alterados.map((k) => [k, atual.a[k]])),
      observacoes_restritas_alteradas: obs !== atual.a.observacoes_restritas_cifradas,
    });
  });
  res.json({ ok: true });
});

assistidosRouter.post('/:id/arquivar', exigir('assistidos.arquivar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const { arquivar } = validar(z.object({ arquivar: z.boolean() }), req.body);
  await tx(req, async (db) => {
    const r = await db.query(
      `UPDATE assistidos SET status = $2, arquivado_em = CASE WHEN $3 THEN now() ELSE NULL END,
         arquivado_por = CASE WHEN $3 THEN $4::uuid ELSE NULL END, atualizado_em = now(), atualizado_por = $4 WHERE id = $1`,
      [id, arquivar ? 'arquivado' : 'ativo', arquivar, req.usuario!.id]);
    if (!r.rowCount) throw new HttpError(404, 'Assistido não encontrado.');
    await auditar(db, req, arquivar ? 'assistido_arquivado' : 'assistido_reativado', 'assistido', id);
  });
  res.json({ ok: true });
});
