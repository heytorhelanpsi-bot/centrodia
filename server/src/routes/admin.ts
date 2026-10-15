import { Router } from 'express';
import { z } from 'zod';
import { exigir, hashSenha, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError, decifrar, sha256, tokenAleatorio } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import { config } from '../config.js';

export const TODAS_PERMISSOES: Record<string, string> = {
  'assistidos.ver': 'Consultar assistidos e registros autorizados',
  'assistidos.editar': 'Cadastrar e editar assistidos',
  'assistidos.arquivar': 'Arquivar/reativar assistidos',
  'assistidos.observacoes_restritas': 'Ver e editar observações restritas',
  'evolucoes.registrar': 'Registrar evoluções individuais',
  'evolucoes.corrigir': 'Corrigir registros finalizados (com auditoria)',
  'evolucoes.editar_data': 'Registrar atendimentos em datas anteriores',
  'coletivas.registrar': 'Registrar atividades em grupo',
  'ia.gerar': 'Gerar análises e minutas com IA',
  'relatorios.elaborar': 'Elaborar e revisar relatórios',
  'relatorios.aprovar': 'Aprovar relatórios',
  'relatorios.ver_aprovados': 'Visualizar relatórios aprovados',
  'exportar': 'Exportar documentos e dados (PDF, CSV, XLSX)',
  'cid.inserir_manual': 'Inserir códigos CID manualmente',
  'atividades.criar': 'Adicionar novas atividades',
  'config.atividades': 'Configurar atividades',
  'config.indicadores': 'Configurar indicadores e escalas',
  'indicadores.criar': 'Adicionar comportamentos (parâmetros) durante o registro',
  'usuarios.gerenciar': 'Gerenciar usuários e permissões',
  'auditoria.ver': 'Consultar logs de auditoria',
  'lgpd.gerenciar': 'Atender direitos dos titulares (LGPD)',
};

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
export const usuariosRouter = Router();

/** Lista mínima para filtros (sem dados sensíveis). */
usuariosRouter.get('/profissionais', async (req, res) => {
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT id, nome FROM usuarios WHERE ativo AND perfil IN ('admin','profissional') ORDER BY nome`)).rows);
  res.json(rows);
});

usuariosRouter.get('/', exigir('usuarios.gerenciar'), async (req, res) => {
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT u.id, u.nome, u.email, u.perfil, u.funcao, u.ativo, u.acesso_todos_assistidos, u.deve_trocar_senha, u.ultimo_login,
            u.bloqueado_ate, u.criado_em,
            (SELECT count(*) FROM usuario_assistido ua WHERE ua.usuario_id = u.id)::int AS assistidos_atribuidos,
            (SELECT count(*) FROM sessoes s WHERE s.usuario_id = u.id AND s.revogada_em IS NULL AND s.expira_em > now())::int AS sessoes_ativas
       FROM usuarios u ORDER BY u.ativo DESC, u.nome`)).rows);
  res.json(rows);
});

const usuarioSchema = z.object({
  nome: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  perfil: z.enum(['admin', 'profissional', 'consulta']),
  funcao: z.string().trim().max(120).nullish().transform((v) => v || null),
  ativo: z.boolean().default(true),
  acesso_todos_assistidos: z.boolean().default(false),
});

function senhaProvisoria() {
  return `${tokenAleatorio(9)}9a`;
}

usuariosRouter.post('/', exigir('usuarios.gerenciar'), async (req, res) => {
  const b = validar(usuarioSchema, req.body);
  const senha = senhaProvisoria();
  const r = await tx(req, async (db) => {
    const r = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, funcao, ativo, acesso_todos_assistidos, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.nome, b.email, await hashSenha(senha), b.perfil, b.funcao, b.ativo, b.acesso_todos_assistidos, req.usuario!.id]);
    await auditar(db, req, 'usuario_criado', 'usuario', r.rows[0].id, { perfil: b.perfil, acesso_todos_assistidos: b.acesso_todos_assistidos });
    return r.rows[0];
  });
  // A senha provisória é exibida uma única vez; o usuário deve trocá-la no primeiro acesso.
  res.status(201).json({ id: r.id, senha_provisoria: senha });
});

usuariosRouter.put('/:id', exigir('usuarios.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(usuarioSchema, req.body);
  await tx(req, async (db) => {
    const atual = await db.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (!atual.rowCount) throw new HttpError(404, 'Usuário não encontrado.');
    if (id === req.usuario!.id && (b.perfil !== 'admin' || !b.ativo)) {
      throw new HttpError(409, 'Você não pode remover seu próprio perfil de administrador ou desativar sua conta.');
    }
    if (atual.rows[0].perfil === 'admin' && (b.perfil !== 'admin' || !b.ativo)) {
      const n = await db.query(`SELECT count(*)::int AS n FROM usuarios WHERE perfil = 'admin' AND ativo AND id <> $1`, [id]);
      if (n.rows[0].n === 0) throw new HttpError(409, 'É necessário manter ao menos um administrador ativo.');
    }
    await db.query(
      `UPDATE usuarios SET nome=$2, email=$3, perfil=$4, funcao=$5, ativo=$6, acesso_todos_assistidos=$7, atualizado_em=now() WHERE id=$1`,
      [id, b.nome, b.email, b.perfil, b.funcao, b.ativo, b.acesso_todos_assistidos]);
    if (!b.ativo || b.perfil !== atual.rows[0].perfil) {
      await db.query('UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
    }
    const a = atual.rows[0];
    await auditar(db, req, 'usuario_atualizado', 'usuario', id, {
      anterior: { perfil: a.perfil, ativo: a.ativo, acesso_todos_assistidos: a.acesso_todos_assistidos },
      novo: { perfil: b.perfil, ativo: b.ativo, acesso_todos_assistidos: b.acesso_todos_assistidos },
    });
  });
  res.json({ ok: true });
});

usuariosRouter.post('/:id/recuperacao', exigir('usuarios.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const token = tokenAleatorio();
  await tx(req, async (db) => {
    const u = await db.query('SELECT 1 FROM usuarios WHERE id = $1 AND ativo', [id]);
    if (!u.rowCount) throw new HttpError(404, 'Usuário não encontrado ou inativo.');
    await db.query(`UPDATE tokens_recuperacao SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL`, [id]);
    await db.query(
      `INSERT INTO tokens_recuperacao (usuario_id, token_hash, emitido_por, expira_em) VALUES ($1,$2,$3, now() + interval '24 hours')`,
      [id, sha256(token), req.usuario!.id]);
    await auditar(db, req, 'recuperacao_emitida', 'usuario', id);
  });
  res.json({ link: `${config.publicUrl}/redefinir-senha#${token}`, expira_em_horas: 24 });
});

usuariosRouter.post('/:id/encerrar-sessoes', exigir('usuarios.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  await tx(req, async (db) => {
    await db.query('UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
    await auditar(db, req, 'sessoes_encerradas', 'usuario', id);
  });
  res.json({ ok: true });
});

usuariosRouter.get('/:id/assistidos', exigir('usuarios.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const rows = await tx(req, async (db) => (await db.query(
    `SELECT assistido_id FROM usuario_assistido WHERE usuario_id = $1`, [id])).rows.map((r) => r.assistido_id));
  res.json(rows);
});

usuariosRouter.put('/:id/assistidos', exigir('usuarios.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const { assistidos } = validar(z.object({ assistidos: z.array(z.string().uuid()).max(5000) }), req.body);
  await tx(req, async (db) => {
    const antes = (await db.query('SELECT assistido_id FROM usuario_assistido WHERE usuario_id = $1', [id])).rows.map((r) => r.assistido_id);
    await db.query('DELETE FROM usuario_assistido WHERE usuario_id = $1', [id]);
    for (const a of new Set(assistidos)) {
      await db.query('INSERT INTO usuario_assistido (usuario_id, assistido_id, atribuido_por) VALUES ($1,$2,$3)', [id, a, req.usuario!.id]);
    }
    await auditar(db, req, 'atribuicoes_alteradas', 'usuario', id, {
      adicionados: assistidos.filter((a) => !antes.includes(a)).length, removidos: antes.filter((a) => !assistidos.includes(a)).length,
    });
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Permissões por perfil
// ---------------------------------------------------------------------------
export const permissoesRouter = Router();

permissoesRouter.get('/', exigir('usuarios.gerenciar'), async (req, res) => {
  const rows = await tx(req, async (db) => (await db.query('SELECT perfil, permissao FROM permissoes_perfil')).rows);
  const matriz: Record<string, string[]> = { admin: [], profissional: [], consulta: [] };
  for (const r of rows) matriz[r.perfil].push(r.permissao);
  res.json({ descricoes: TODAS_PERMISSOES, matriz });
});

permissoesRouter.put('/:perfil', exigir('usuarios.gerenciar'), async (req, res) => {
  const perfil = validar(z.enum(['admin', 'profissional', 'consulta']), req.params.perfil);
  const { permissoes } = validar(z.object({ permissoes: z.array(z.enum(Object.keys(TODAS_PERMISSOES) as [string, ...string[]])) }), req.body);
  if (perfil === 'admin' && !permissoes.includes('usuarios.gerenciar')) {
    throw new HttpError(409, 'O perfil administrador deve manter a permissão de gerenciar usuários.');
  }
  if (perfil === 'consulta' && permissoes.some((p) => !['assistidos.ver', 'relatorios.ver_aprovados', 'exportar'].includes(p))) {
    throw new HttpError(409, 'O perfil de consulta não pode receber permissões de alteração de registros.');
  }
  await tx(req, async (db) => {
    const antes = (await db.query('SELECT permissao FROM permissoes_perfil WHERE perfil = $1', [perfil])).rows.map((r) => r.permissao);
    await db.query('DELETE FROM permissoes_perfil WHERE perfil = $1', [perfil]);
    for (const p of new Set(permissoes)) await db.query('INSERT INTO permissoes_perfil VALUES ($1,$2)', [perfil, p]);
    await auditar(db, req, 'permissoes_alteradas', 'perfil', perfil, {
      adicionadas: permissoes.filter((p) => !antes.includes(p)), removidas: antes.filter((p) => !permissoes.includes(p)),
    });
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Configurações institucionais
// ---------------------------------------------------------------------------
export const configRouter = Router();

configRouter.get('/', async (req, res) => {
  const rows = await tx(req, async (db) => (await db.query('SELECT chave, valor FROM configuracoes')).rows);
  res.json(Object.fromEntries(rows.map((r) => [r.chave, r.valor])));
});

const configSchemas: Record<string, z.ZodType> = {
  instituicao: z.object({
    nome: z.string().trim().min(2).max(200), endereco: z.string().trim().max(300).default(''),
    cnpj: z.string().trim().max(30).default(''), responsavel_tecnico: z.string().trim().max(200).default(''),
  }),
  ia: z.object({ habilitada: z.boolean(), enviar_nome: z.literal(false).default(false) }),
  rotina: z.object({ dias: z.array(z.number().int().min(1).max(6)).min(1, 'Escolha ao menos um dia').max(6)
    .transform((d) => [...new Set(d)].sort()) }),
  retencao: z.object({ descricao: z.string().trim().max(4000), prazo_anos: z.number().int().min(1).max(100).nullable() }),
};

configRouter.put('/:chave', exigir('usuarios.gerenciar'), async (req, res) => {
  const chave = validar(z.enum(['instituicao', 'ia', 'retencao', 'rotina']), req.params.chave);
  const valor = validar(configSchemas[chave], req.body);
  await tx(req, async (db) => {
    await db.query(
      `INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1,$2,$3)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [chave, valor, req.usuario!.id]);
    await auditar(db, req, 'configuracao_alterada', 'configuracao', chave, { valor });
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
export const auditoriaRouter = Router();

auditoriaRouter.get('/', exigir('auditoria.ver'), async (req, res) => {
  const q = validar(z.object({
    acao: z.string().trim().max(60).optional(), usuario_id: z.string().uuid().optional(),
    inicio: dataISO.optional(), fim: dataISO.optional(), entidade_id: z.string().max(60).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
  }), req.query);
  const rows = await tx(req, async (db) => {
    const r = await db.query(
      `SELECT a.id, a.ocorrido_em, a.acao, a.entidade, a.entidade_id, a.detalhes, a.ip, u.nome AS usuario_nome
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE ($1::text IS NULL OR a.acao ILIKE '%' || $1 || '%') AND ($2::uuid IS NULL OR a.usuario_id = $2)
          AND ($3::date IS NULL OR a.ocorrido_em >= $3) AND ($4::date IS NULL OR a.ocorrido_em < $4::date + 1)
          AND ($5::text IS NULL OR a.entidade_id = $5)
        ORDER BY a.id DESC LIMIT 100 OFFSET $6`,
      [q.acao ?? null, q.usuario_id ?? null, q.inicio ?? null, q.fim ?? null, q.entidade_id ?? null, (q.pagina - 1) * 100]);
    await auditar(db, req, 'consulta_auditoria', null, null, { filtros: q });
    return r.rows;
  });
  res.json(rows);
});

// ---------------------------------------------------------------------------
// LGPD — direitos dos titulares
// ---------------------------------------------------------------------------
export const lgpdRouter = Router();

/** Exporta todos os dados do titular (portabilidade/acesso). */
lgpdRouter.get('/assistidos/:id/exportar', exigir('lgpd.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const dados = await tx(req, async (db) => {
    const a = await db.query('SELECT * FROM assistidos WHERE id = $1', [id]);
    if (!a.rowCount) throw new HttpError(404, 'Assistido não encontrado.');
    const q = async (sql: string) => (await db.query(sql, [id])).rows;
    const cad = { ...a.rows[0], observacoes_restritas: decifrar(a.rows[0].observacoes_restritas_cifradas), observacoes_restritas_cifradas: undefined };
    const out = {
      gerado_em: new Date().toISOString(),
      cadastro: cad,
      agenda: await q('SELECT dia_semana FROM assistido_agenda WHERE assistido_id = $1'),
      diagnosticos: await q('SELECT descricao, cid_codigo, situacao, fonte_documental, criado_em FROM assistido_diagnosticos WHERE assistido_id = $1'),
      evolucoes: await q(`SELECT e.*, (SELECT json_agg(ea) FROM evolucao_atividades ea WHERE ea.evolucao_id = e.id) AS atividades,
                            (SELECT json_agg(av) FROM avaliacoes_indicadores av WHERE av.evolucao_id = e.id) AS avaliacoes
                            FROM evolucoes e WHERE e.assistido_id = $1 ORDER BY e.data`),
      correcoes: await q('SELECT c.* FROM evolucao_correcoes c JOIN evolucoes e ON e.id = c.evolucao_id WHERE e.assistido_id = $1'),
      analises_ia: await q('SELECT * FROM analises_ia WHERE assistido_id = $1'),
      relatorios: await q(`SELECT r.*, (SELECT json_agg(v) FROM relatorio_versoes v WHERE v.relatorio_id = r.id) AS versoes FROM relatorios r WHERE r.assistido_id = $1`),
    };
    await auditar(db, req, 'lgpd_exportacao_titular', 'assistido', id);
    return out;
  });
  res.setHeader('Content-Disposition', `attachment; filename="dados-titular-${dados.cadastro.codigo}.json"`);
  res.json(dados);
});

/**
 * Anonimiza o cadastro (nome, data de nascimento exata e observações restritas).
 * Os registros técnicos são mantidos para cumprir obrigações de guarda documental.
 */
lgpdRouter.post('/assistidos/:id/anonimizar', exigir('lgpd.gerenciar'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const b = validar(z.object({ confirmacao_codigo: z.string(), motivo: z.string().trim().min(10) }), req.body);
  await tx(req, async (db) => {
    const a = await db.query('SELECT codigo, data_nascimento, anonimizado_em FROM assistidos WHERE id = $1', [id]);
    if (!a.rowCount) throw new HttpError(404, 'Assistido não encontrado.');
    if (a.rows[0].anonimizado_em) throw new HttpError(409, 'Cadastro já anonimizado.');
    if (b.confirmacao_codigo !== a.rows[0].codigo) throw new HttpError(400, 'Código de confirmação não confere.');
    const ano = a.rows[0].data_nascimento?.slice(0, 4);
    await db.query(
      `UPDATE assistidos SET nome_completo = $2, nome_busca = $3, data_nascimento = $4, anamnese = NULL, observacoes_restritas_cifradas = NULL,
          status = 'arquivado', arquivado_em = coalesce(arquivado_em, now()), anonimizado_em = now(), atualizado_em = now(), atualizado_por = $5
        WHERE id = $1`,
      [id, `Titular anonimizado ${a.rows[0].codigo}`, `titular anonimizado ${a.rows[0].codigo.toLowerCase()}`, ano ? `${ano}-01-01` : null, req.usuario!.id]);
    await auditar(db, req, 'lgpd_anonimizacao', 'assistido', id, { motivo: b.motivo });
  });
  res.json({ ok: true });
});

lgpdRouter.post('/remover-exemplos', exigir('lgpd.gerenciar', 'usuarios.gerenciar'), async (req, res) => {
  const r = await tx(req, async (db) => {
    const r = await db.query('SELECT remover_dados_exemplo() AS r');
    await auditar(db, req, 'dados_exemplo_removidos', null, null, r.rows[0].r);
    return r.rows[0].r;
  });
  res.json(r);
});

lgpdRouter.get('/retencao', exigir('lgpd.gerenciar'), async (req, res) => {
  const r = await tx(req, async (db) => {
    const cfg = (await db.query(`SELECT valor FROM configuracoes WHERE chave = 'retencao'`)).rows[0]?.valor ?? {};
    const exemplos = (await db.query('SELECT count(*)::int AS n FROM assistidos WHERE exemplo')).rows[0].n;
    if (!cfg.prazo_anos) return { configuracao: cfg, vencidos: [], exemplos };
    const v = await db.query(
      `SELECT a.id, a.codigo, a.arquivado_em, (SELECT max(data) FROM evolucoes e WHERE e.assistido_id = a.id) AS ultimo_registro
         FROM assistidos a WHERE a.status = 'arquivado' AND a.anonimizado_em IS NULL
          AND a.arquivado_em < now() - make_interval(years => $1) ORDER BY a.arquivado_em`, [cfg.prazo_anos]);
    return { configuracao: cfg, vencidos: v.rows, exemplos };
  });
  res.json(r);
});
