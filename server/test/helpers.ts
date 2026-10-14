import pg from 'pg';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { hashSenha } from '../src/lib/auth.js';

export const app = criarApp();
export const owner = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
export const SENHA = 'SenhaForte123';

let seq = 0;
export async function criarUsuario(perfil: 'admin' | 'profissional' | 'consulta', opts: { todos?: boolean } = {}) {
  seq++;
  const email = `${perfil}${seq}-${Date.now()}@teste.org`;
  const r = await owner.query(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, acesso_todos_assistidos, deve_trocar_senha)
     VALUES ($1,$2,$3,$4,$5,false) RETURNING id`,
    [`Usuário ${perfil} ${seq}`, email, await hashSenha(SENHA), perfil, opts.todos ?? perfil === 'admin']);
  return { id: r.rows[0].id as string, email };
}

/** Agente HTTP autenticado (mantém cookie de sessão e envia o cabeçalho anti-CSRF). */
export async function entrar(email: string, senha = SENHA) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set('X-Requested-With', 'reabilita').send({ email, senha });
  if (r.status !== 200) throw new Error(`login falhou: ${r.status} ${JSON.stringify(r.body)}`);
  const h = { 'X-Requested-With': 'reabilita' };
  return {
    get: (u: string) => agent.get(u),
    post: (u: string, b?: object) => agent.post(u).set(h).send(b ?? {}),
    put: (u: string, b?: object) => agent.put(u).set(h).send(b ?? {}),
    del: (u: string) => agent.delete(u).set(h),
  };
}

let nomeSeq = 0;
export function novoAssistido(extra: object = {}) {
  nomeSeq++;
  return {
    nome_completo: `Pessoa Teste ${nomeSeq} ${Math.random().toString(36).slice(2, 8)} Silvestre`, data_nascimento: '2010-05-20', turno_habitual: 'manha',
    dias_atendimento: [1, 3], diagnosticos: [], ...extra,
  };
}

export async function indicadores(c: Awaited<ReturnType<typeof entrar>>) {
  const r = await c.get('/api/indicadores');
  return Object.fromEntries(r.body.map((i: any) => [i.chave, i]));
}
export async function atividades(c: Awaited<ReturnType<typeof entrar>>) {
  const r = await c.get('/api/atividades');
  return Object.fromEntries(r.body.map((a: any) => [a.nome, a.id]));
}

export function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
