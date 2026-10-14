// Cria o primeiro administrador.  Uso: npm run create-admin -- "Nome" email@dominio
import { pool } from '../db/pool.js';
import { hashSenha } from '../lib/auth.js';
import { tokenAleatorio } from '../lib/util.js';

const [nome, email] = process.argv.slice(2);
if (!nome || !email) {
  console.error('Uso: npm run create-admin -- "Nome Completo" email@dominio');
  process.exit(1);
}
const senha = `${tokenAleatorio(9)}9a`;
const r = await pool.query(
  `INSERT INTO usuarios (nome, email, senha_hash, perfil, acesso_todos_assistidos, deve_trocar_senha)
   VALUES ($1, lower($2), $3, 'admin', true, true) RETURNING id`, [nome, email, await hashSenha(senha)]);
await pool.query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'admin_inicial_criado', 'usuario', $2)`, [r.rows[0].id, r.rows[0].id]);
console.log(`Administrador criado: ${email}\nSenha provisória (troca obrigatória no primeiro acesso): ${senha}`);
await pool.end();
