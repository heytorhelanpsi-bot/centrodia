import crypto from 'node:crypto';
import pg from 'pg';
import { pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { config } from '../config.js';
import { hashSenha, validarSenhaForte } from './auth.js';

/**
 * Inicialização (servidor tradicional ou função serverless):
 * 1. confere se há banco conectado;
 * 2. aplica as migrações pendentes (MIGRAR_AO_INICIAR; padrão na Vercel), criando o papel da aplicação;
 * 3. carrega a chave de cifragem (DATA_ENCRYPTION_KEY ou a gerada e guardada no banco);
 * 4. recusa iniciar se a conexão da aplicação ignorar a RLS;
 * 5. opcionalmente cria o primeiro administrador por ADMIN_EMAIL + ADMIN_SENHA_INICIAL.
 *    Sem essas variáveis, o primeiro administrador é criado na tela inicial do app.
 */
export async function inicializar() {
  if (!config.databaseUrl) {
    throw new Error('Banco de dados não conectado. Na Vercel: Storage › Create Database › Neon e conecte ao projeto; depois faça um Redeploy.');
  }
  if (config.migrarAoIniciar) {
    if (!config.migrationDatabaseUrl) throw new Error('MIGRAR_AO_INICIAR exige MIGRATION_DATABASE_URL');
    await migrate();
  }
  await carregarChaveCifragem();
  await verificarPapelSeguro();
  await criarAdminPorVariaveis();
}

async function carregarChaveCifragem() {
  if (config.dataEncryptionKey) return;
  if (!config.migrationDatabaseUrl) {
    throw new Error('DATA_ENCRYPTION_KEY não definida. Defina a variável ou forneça a conexão do proprietário para gerá-la automaticamente.');
  }
  const c = new pg.Client({ connectionString: config.migrationDatabaseUrl });
  await c.connect();
  try {
    await c.query(`INSERT INTO segredos_sistema (chave, valor) VALUES ('data_encryption_key', $1) ON CONFLICT (chave) DO NOTHING`,
      [crypto.randomBytes(32).toString('base64')]);
    const r = await c.query(`SELECT valor FROM segredos_sistema WHERE chave = 'data_encryption_key'`);
    config.dataEncryptionKey = r.rows[0].valor;
  } finally {
    await c.end();
  }
}

async function criarAdminPorVariaveis() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const senha = process.env.ADMIN_SENHA_INICIAL;
  if (!email || !senha) return;
  const n = await pool.query('SELECT count(*)::int AS n FROM usuarios');
  if (n.rows[0].n > 0) {
    console.log('ADMIN_EMAIL ignorado: já existem usuários. Remova ADMIN_EMAIL e ADMIN_SENHA_INICIAL das variáveis de ambiente.');
    return;
  }
  const erro = validarSenhaForte(senha);
  if (erro) throw new Error(`ADMIN_SENHA_INICIAL inválida: ${erro}`);
  const r = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, acesso_todos_assistidos, deve_trocar_senha)
     VALUES ($1, lower($2), $3, 'admin', true, true) RETURNING id`,
    [process.env.ADMIN_NOME?.trim() || 'Administração', email, await hashSenha(senha)]);
  await pool.query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'admin_inicial_criado', 'usuario', $2)`,
    [r.rows[0].id, r.rows[0].id]);
  console.log(`Administrador inicial criado: ${email} (troca de senha obrigatória no primeiro acesso).`);
}

/**
 * Recusa iniciar se a aplicação estiver conectada com um papel que ignora a segurança em nível de
 * linha (superusuário, BYPASSRLS ou dono das tabelas) — ex.: DATABASE_URL do proprietário por engano.
 */
export async function verificarPapelSeguro() {
  const r = await pool.query(
    `SELECT current_user AS papel, r.rolsuper, r.rolbypassrls,
            (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'assistidos') AS dono
       FROM pg_roles r WHERE r.rolname = current_user`);
  const x = r.rows[0];
  if (!x.dono) throw new Error('Banco sem as tabelas do PsiDia. Configure MIGRATION_DATABASE_URL (ou DATABASE_URL_UNPOOLED) e MIGRAR_AO_INICIAR=true.');
  if (x.rolsuper || x.rolbypassrls || x.dono === x.papel) {
    throw new Error(`Configuração insegura: a aplicação está conectada como "${x.papel}", que ignora as regras de acesso (RLS). ` +
      'Defina APP_DATABASE_URL com um papel sem privilégios, ou forneça a conexão do proprietário para que o papel psidia_app seja criado.');
  }
}
