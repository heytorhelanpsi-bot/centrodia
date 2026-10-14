import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import {
  COOKIE_SESSAO, conferirSenha, criarSessao, exigirLogin, hashSenha, limparCookie, validarSenhaForte,
} from '../lib/auth.js';
import { HttpError, sha256 } from '../lib/util.js';
import { validar } from '../lib/validacao.js';

export const authRouter = Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

const MAX_FALHAS = 5;
let hashFicticio: string | null = null; // gerado sob demanda (evita custo na inicialização)
const BLOQUEIO_MIN = 15;

async function registrarAuditoria(usuarioId: string | null, acao: string, ip: string | undefined, detalhes = {}) {
  await pool.query(
    'INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [usuarioId, acao, 'sessao', usuarioId, detalhes, ip ?? null],
  );
}

authRouter.post('/login', limiteLogin, async (req, res) => {
  const { email, senha } = validar(z.object({ email: z.string().trim().min(3), senha: z.string().min(1) }), req.body);
  const r = await pool.query('SELECT * FROM usuarios WHERE lower(email) = lower($1)', [email]);
  const u = r.rows[0];
  const falha = new HttpError(401, 'E-mail ou senha incorretos.');
  if (!u || !u.ativo) {
    hashFicticio ??= bcrypt.hashSync('senha-ficticia-para-tempo-constante', 12);
    await conferirSenha(senha, hashFicticio); // tempo de resposta semelhante
    await registrarAuditoria(null, 'login_falhou', req.ip, { email });
    throw falha;
  }
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
    throw new HttpError(423, 'Conta temporariamente bloqueada por tentativas incorretas. Tente mais tarde ou procure a administração.');
  }
  if (!(await conferirSenha(senha, u.senha_hash))) {
    const falhas = u.tentativas_falhas + 1;
    const bloquear = falhas >= MAX_FALHAS;
    await pool.query(
      `UPDATE usuarios SET tentativas_falhas = $2::int,
         bloqueado_ate = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE NULL END
       WHERE id = $1`, [u.id, bloquear ? 0 : falhas, bloquear, BLOQUEIO_MIN]);
    await registrarAuditoria(u.id, 'login_falhou', req.ip);
    throw falha;
  }
  await pool.query('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login = now() WHERE id = $1', [u.id]);
  await criarSessao(u.id, req, res);
  await registrarAuditoria(u.id, 'login', req.ip);
  res.json({ ok: true, deveTrocarSenha: u.deve_trocar_senha });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_SESSAO];
  if (typeof token === 'string') {
    await pool.query('UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1 AND revogada_em IS NULL', [sha256(token)]);
  }
  if (req.usuario) await registrarAuditoria(req.usuario.id, 'logout', req.ip);
  limparCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', exigirLogin, (req, res) => {
  const u = req.usuario!;
  res.json({
    id: u.id, nome: u.nome, email: u.email, perfil: u.perfil,
    deveTrocarSenha: u.deveTrocarSenha, permissoes: [...u.permissoes].sort(),
  });
});

authRouter.post('/trocar-senha', exigirLogin, async (req, res) => {
  const { atual, nova } = validar(z.object({ atual: z.string().min(1), nova: z.string() }), req.body);
  const erro = validarSenhaForte(nova);
  if (erro) throw new HttpError(400, erro);
  const r = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  if (!(await conferirSenha(atual, r.rows[0].senha_hash))) throw new HttpError(400, 'Senha atual incorreta.');
  if (atual === nova) throw new HttpError(400, 'A nova senha deve ser diferente da atual.');
  await pool.query('UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = false, atualizado_em = now() WHERE id = $1',
    [req.usuario!.id, await hashSenha(nova)]);
  // Encerra as demais sessões do usuário.
  await pool.query('UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND id <> $2 AND revogada_em IS NULL',
    [req.usuario!.id, req.usuario!.sessaoId]);
  await registrarAuditoria(req.usuario!.id, 'senha_alterada', req.ip);
  res.json({ ok: true });
});

/** Redefinição com token de uso único emitido pela administração. */
authRouter.post('/redefinir-senha', limiteLogin, async (req, res) => {
  const { token, nova } = validar(z.object({ token: z.string().min(20), nova: z.string() }), req.body);
  const erro = validarSenhaForte(nova);
  if (erro) throw new HttpError(400, erro);
  const r = await pool.query(
    `UPDATE tokens_recuperacao SET usado_em = now()
      WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now() RETURNING usuario_id`, [sha256(token)]);
  if (!r.rowCount) throw new HttpError(400, 'Link de redefinição inválido ou expirado. Solicite um novo à administração.');
  const uid = r.rows[0].usuario_id;
  await pool.query(
    `UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = false, tentativas_falhas = 0, bloqueado_ate = NULL,
       atualizado_em = now() WHERE id = $1`, [uid, await hashSenha(nova)]);
  await pool.query('UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [uid]);
  await registrarAuditoria(uid, 'senha_redefinida', req.ip);
  res.json({ ok: true });
});

/**
 * Configuração inicial: enquanto não existir nenhum usuário, permite criar o primeiro administrador
 * pela tela do app (dispensa variáveis de ambiente no deploy). Depois disso, o endpoint fica bloqueado.
 */
authRouter.get('/configuracao-inicial', async (_req, res) => {
  const r = await pool.query('SELECT NOT EXISTS (SELECT 1 FROM usuarios) AS necessaria');
  res.json({ necessaria: r.rows[0].necessaria });
});

authRouter.post('/configuracao-inicial', limiteLogin, async (req, res) => {
  const b = validar(z.object({
    nome: z.string().trim().min(2, 'Informe seu nome').max(150),
    email: z.string().trim().toLowerCase().email('E-mail inválido'),
    senha: z.string(),
  }), req.body);
  const erro = validarSenhaForte(b.senha);
  if (erro) throw new HttpError(400, erro, [{ campo: 'senha', mensagem: erro }]);
  const hash = await hashSenha(b.senha);
  const client = await pool.connect();
  let id: string;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727275)');
    const existe = await client.query('SELECT 1 FROM usuarios LIMIT 1');
    if (existe.rowCount) throw new HttpError(409, 'A configuração inicial já foi feita. Entre com seu e-mail e senha.');
    const r = await client.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, acesso_todos_assistidos, deve_trocar_senha)
       VALUES ($1, $2, $3, 'admin', true, false) RETURNING id`, [b.nome, b.email, hash]);
    id = r.rows[0].id;
    await client.query(
      `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, ip) VALUES ($1, 'admin_inicial_criado', 'usuario', $2, $3)`,
      [id, id, req.ip ?? null]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await criarSessao(id, req, res);
  res.status(201).json({ ok: true });
});
