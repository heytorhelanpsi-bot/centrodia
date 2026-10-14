import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError, sha256, tokenAleatorio } from './util.js';

export const COOKIE_SESSAO = 'ps_sessao';
const INATIVIDADE_MIN = 30;
const DURACAO_MAX_H = 12;

export async function hashSenha(senha: string) {
  return bcrypt.hash(senha, 12);
}
export async function conferirSenha(senha: string, hash: string) {
  return bcrypt.compare(senha, hash);
}

/** Política mínima: 10+ caracteres, com letras e números. */
export function validarSenhaForte(senha: string): string | null {
  if (senha.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

export async function criarSessao(usuarioId: string, req: Request, res: Response) {
  const token = tokenAleatorio();
  await pool.query(
    `INSERT INTO sessoes (usuario_id, token_hash, expira_em, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5)`,
    [usuarioId, sha256(token), DURACAO_MAX_H, req.ip ?? null, (req.get('user-agent') ?? '').slice(0, 300)],
  );
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', maxAge: DURACAO_MAX_H * 3600_000,
  });
}

export function limparCookie(res: Response) {
  res.clearCookie(COOKIE_SESSAO, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

/** Carrega o usuário da sessão (se houver). Não bloqueia a requisição. */
export async function carregarSessao(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_SESSAO];
  if (!token || typeof token !== 'string') return next();
  const r = await pool.query(
    `UPDATE sessoes s SET ultimo_uso = now()
       FROM usuarios u
      WHERE s.token_hash = $1 AND s.usuario_id = u.id AND u.ativo
        AND s.revogada_em IS NULL AND s.expira_em > now()
        AND s.ultimo_uso > now() - make_interval(mins => $2)
     RETURNING s.id AS sessao_id, u.id, u.nome, u.email, u.perfil, u.deve_trocar_senha`,
    [sha256(token), INATIVIDADE_MIN],
  );
  if (r.rowCount) {
    const u = r.rows[0];
    const p = await pool.query('SELECT permissao FROM permissoes_perfil WHERE perfil = $1', [u.perfil]);
    req.usuario = {
      id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, sessaoId: u.sessao_id,
      deveTrocarSenha: u.deve_trocar_senha, permissoes: new Set(p.rows.map((x) => x.permissao)),
    };
  }
  next();
}

export function exigirLogin(req: Request, _res: Response, next: NextFunction) {
  if (!req.usuario) throw new HttpError(401, 'Sessão expirada ou inexistente. Entre novamente.');
  next();
}

/** Bloqueia operações enquanto a troca obrigatória de senha não for feita. */
export function exigirSenhaAtualizada(req: Request, _res: Response, next: NextFunction) {
  if (req.usuario?.deveTrocarSenha) throw new HttpError(403, 'Troque sua senha provisória antes de continuar.');
  next();
}

export function exigir(...permissoes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.usuario;
    if (!u) throw new HttpError(401, 'Sessão expirada ou inexistente. Entre novamente.');
    if (!permissoes.every((p) => u.permissoes.has(p))) {
      throw new HttpError(403, 'Você não tem permissão para esta operação.');
    }
    next();
  };
}

export function tem(req: Request, permissao: string) {
  return !!req.usuario?.permissoes.has(permissao);
}

/** Executa uma transação no contexto (RLS) do usuário autenticado. */
export function tx<T>(req: Request, fn: Parameters<typeof withTx<T>>[1]) {
  return withTx<T>({ usuarioId: req.usuario?.id ?? null }, fn);
}
