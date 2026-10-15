import { Router } from 'express';
import { z } from 'zod';
import { exigir, tem, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError } from '../lib/util.js';
import { validar } from '../lib/validacao.js';

// ---------------------------------------------------------------------------
// CID
// ---------------------------------------------------------------------------
export const cidRouter = Router();

cidRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const { busca } = validar(z.object({ busca: z.string().trim().max(100).default('') }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT codigo, descricao, origem FROM cid_codigos
      WHERE $1 = '' OR codigo ILIKE $2 OR descricao ILIKE $3
      ORDER BY codigo LIMIT 30`, [busca, `${busca}%`, `%${busca}%`])).rows);
  res.json(rows);
});

const cidSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/, 'Formato esperado: letra + 2 dígitos, opcionalmente .subcategoria (ex.: F84.0)'),
  descricao: z.string().trim().min(3).max(300),
});

cidRouter.post('/', exigir('cid.inserir_manual'), async (req, res) => {
  const b = validar(cidSchema, req.body);
  await tx(req, async (db) => {
    await db.query(`INSERT INTO cid_codigos (codigo, descricao, origem, criado_por) VALUES ($1,$2,'manual',$3)`, [b.codigo, b.descricao, req.usuario!.id]);
    await auditar(db, req, 'cid_inserido', 'cid', b.codigo, b);
  });
  res.status(201).json({ ok: true });
});

/** Importação em lote (CSV "codigo;descricao") da tabela oficial. */
cidRouter.post('/importar', exigir('cid.inserir_manual', 'usuarios.gerenciar'), async (req, res) => {
  const { csv } = validar(z.object({ csv: z.string().max(5_000_000) }), req.body);
  let inseridos = 0, ignorados = 0;
  const erros: string[] = [];
  await tx(req, async (db) => {
    for (const [i, linha] of csv.split(/\r?\n/).entries()) {
      if (!linha.trim()) continue;
      const [cod, ...resto] = linha.split(/[;\t]/);
      const p = cidSchema.safeParse({ codigo: cod?.replace(/^(\w\d\d)(\d)$/, '$1.$2'), descricao: resto.join(' ').replace(/^"|"$/g, '') });
      if (!p.success) { if (i > 0) erros.push(`Linha ${i + 1}`); continue; }
      const r = await db.query(`INSERT INTO cid_codigos (codigo, descricao, origem, criado_por) VALUES ($1,$2,'importacao',$3) ON CONFLICT DO NOTHING`,
        [p.data.codigo, p.data.descricao, req.usuario!.id]);
      if (r.rowCount) inseridos++; else ignorados++;
    }
    await auditar(db, req, 'cid_importado', 'cid', null, { inseridos, ignorados, erros: erros.length });
  });
  res.json({ inseridos, ignorados, erros: erros.slice(0, 50) });
});

// ---------------------------------------------------------------------------
// Atividades
// ---------------------------------------------------------------------------
export const atividadesRouter = Router();

atividadesRouter.get('/', async (req, res) => {
  const { todas } = validar(z.object({ todas: z.enum(['0', '1']).default('0') }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT a.*, coalesce((SELECT array_agg(indicador_id) FROM atividade_indicadores ai WHERE ai.atividade_id = a.id), '{}') AS indicadores_recomendados
       FROM atividades a WHERE $1 OR a.ativo ORDER BY a.padrao DESC, a.nome`, [todas === '1'])).rows);
  res.json(rows);
});

const atividadeSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  categoria: z.string().trim().min(2).max(80).default('Geral'),
  descricao: z.string().trim().max(2000).nullish().transform((v) => v || null),
  ativo: z.boolean().default(true),
  indicadores_recomendados: z.array(z.string().uuid()).default([]),
});

atividadesRouter.post('/', exigir('atividades.criar'), async (req, res) => {
  const b = validar(atividadeSchema, req.body);
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO atividades (nome, categoria, descricao, ativo, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.nome, b.categoria, b.descricao, b.ativo, req.usuario!.id]);
    for (const i of b.indicadores_recomendados) await db.query('INSERT INTO atividade_indicadores VALUES ($1,$2)', [r.rows[0].id, i]);
    await auditar(db, req, 'atividade_criada', 'atividade', r.rows[0].id, { nome: b.nome });
    return r.rows[0];
  });
  res.status(201).json(r);
});

atividadesRouter.put('/:id', exigir('config.atividades'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(atividadeSchema, req.body);
  await tx(req, async (db) => {
    const r = await db.query(
      `UPDATE atividades SET nome=$2, categoria=$3, descricao=$4, ativo=$5, atualizado_em=now() WHERE id=$1`,
      [id, b.nome, b.categoria, b.descricao, b.ativo]);
    if (!r.rowCount) throw new HttpError(404, 'Atividade não encontrada.');
    await db.query('DELETE FROM atividade_indicadores WHERE atividade_id = $1', [id]);
    for (const i of b.indicadores_recomendados) await db.query('INSERT INTO atividade_indicadores VALUES ($1,$2)', [id, i]);
    await auditar(db, req, 'atividade_atualizada', 'atividade', id, b);
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Indicadores e versões de escala
// ---------------------------------------------------------------------------
export const indicadoresRouter = Router();

indicadoresRouter.get('/', async (req, res) => {
  const { todos } = validar(z.object({ todos: z.enum(['0', '1']).default('0') }), req.query);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT * FROM indicadores_vigentes WHERE $1 OR ativo ORDER BY ordem, nome`, [todos === '1'])).rows);
  res.json(rows);
});

indicadoresRouter.get('/:id/versoes', async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT v.*, u.nome AS criado_por_nome FROM indicador_escala_versoes v LEFT JOIN usuarios u ON u.id = v.criado_por
      WHERE indicador_id = $1 ORDER BY versao DESC`, [id])).rows);
  res.json(rows);
});

const escalaSchema = z.object({
  minimo: z.number().int().min(0).max(9),
  maximo: z.number().int().min(1).max(10),
  direcao: z.enum(['maior_melhor', 'menor_melhor', 'neutra']),
  niveis: z.array(z.object({ valor: z.number().int(), descricao: z.string().trim().min(1).max(300) })),
}).superRefine((e, ctx) => {
  if (e.minimo >= e.maximo) ctx.addIssue({ code: 'custom', message: 'Mínimo deve ser menor que o máximo', path: ['minimo'] });
  const esperados = Array.from({ length: e.maximo - e.minimo + 1 }, (_, i) => e.minimo + i);
  const valores = e.niveis.map((n) => n.valor).sort((a, b) => a - b);
  if (JSON.stringify(esperados) !== JSON.stringify(valores)) {
    ctx.addIssue({ code: 'custom', message: 'Descreva cada nível da escala exatamente uma vez', path: ['niveis'] });
  }
});

const indicadorSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().trim().max(2000).nullish().transform((v) => v || null),
  tipo: z.enum(['positivo', 'monitoramento', 'autonomia', 'outro']),
  observacao_obrigatoria: z.boolean().default(false),
  ativo: z.boolean().default(true),
  ordem: z.number().int().min(0).max(1000).default(100),
});

/** Escala 0–5 padrão, usada quando o comportamento é criado durante o registro. */
function escalaPadrao(tipo: string): z.infer<typeof escalaSchema> {
  const desc = tipo === 'monitoramento'
    ? ['Não observado no período avaliado', 'Muito baixo', 'Baixo', 'Moderado', 'Elevado', 'Muito elevado']
    : ['Não observado ou ausência na situação registrada', 'Muito reduzido', 'Baixo', 'Moderado', 'Bom', 'Muito bom'];
  return { minimo: 0, maximo: 5, direcao: tipo === 'monitoramento' ? 'menor_melhor' : tipo === 'outro' ? 'neutra' : 'maior_melhor',
    niveis: desc.map((descricao, valor) => ({ valor, descricao })) };
}

indicadoresRouter.post('/', async (req, res) => {
  if (!tem(req, 'config.indicadores') && !tem(req, 'indicadores.criar')) throw new HttpError(403, 'Você não tem permissão para esta operação.');
  const p = validar(indicadorSchema.extend({ escala: escalaSchema.optional() }), req.body);
  const b = { ...p, escala: p.escala ?? escalaPadrao(p.tipo) };
  const chave = `custom_${Date.now().toString(36)}`;
  const r = await tx(req, async (db) => {
    const existe = await db.query('SELECT 1 FROM indicadores WHERE lower(nome) = lower($1)', [b.nome]);
    if (existe.rowCount) throw new HttpError(409, `Já existe um comportamento chamado "${b.nome}".`);
    const r = await db.query(
      `INSERT INTO indicadores (chave, nome, descricao, tipo, observacao_obrigatoria, ativo, ordem, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [chave, b.nome, b.descricao, b.tipo, b.observacao_obrigatoria, b.ativo, b.ordem, req.usuario!.id]);
    const id = r.rows[0].id;
    await db.query(
      `INSERT INTO indicador_escala_versoes (indicador_id, versao, minimo, maximo, direcao, niveis, criado_por) VALUES ($1,1,$2,$3,$4,$5,$6)`,
      [id, b.escala.minimo, b.escala.maximo, b.escala.direcao, JSON.stringify(b.escala.niveis.sort((x, y) => x.valor - y.valor)), req.usuario!.id]);
    await auditar(db, req, 'indicador_criado', 'indicador', id, { nome: b.nome });
    return { id };
  });
  res.status(201).json(r);
});

indicadoresRouter.put('/:id', exigir('config.indicadores'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(indicadorSchema, req.body);
  await tx(req, async (db) => {
    const r = await db.query(
      `UPDATE indicadores SET nome=$2, descricao=$3, tipo=$4, observacao_obrigatoria=$5, ativo=$6, ordem=$7, atualizado_em=now() WHERE id=$1`,
      [id, b.nome, b.descricao, b.tipo, b.observacao_obrigatoria, b.ativo, b.ordem]);
    if (!r.rowCount) throw new HttpError(404, 'Indicador não encontrado.');
    await auditar(db, req, 'indicador_atualizado', 'indicador', id, b);
  });
  res.json({ ok: true });
});

/** Alterar a escala cria uma nova versão; avaliações antigas mantêm a versão original. */
indicadoresRouter.post('/:id/versoes', exigir('config.indicadores'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const e = validar(escalaSchema, req.body);
  const r = await tx(req, async (db) => {
    const v = await db.query('SELECT coalesce(max(versao), 0) + 1 AS prox FROM indicador_escala_versoes WHERE indicador_id = $1', [id]);
    const r = await db.query(
      `INSERT INTO indicador_escala_versoes (indicador_id, versao, minimo, maximo, direcao, niveis, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, versao`,
      [id, v.rows[0].prox, e.minimo, e.maximo, e.direcao, JSON.stringify(e.niveis.sort((x, y) => x.valor - y.valor)), req.usuario!.id]);
    await auditar(db, req, 'escala_nova_versao', 'indicador', id, { versao: r.rows[0].versao });
    return r.rows[0];
  });
  res.status(201).json(r);
});
