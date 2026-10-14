import { pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { config } from '../config.js';
import { hashSenha, validarSenhaForte } from './auth.js';

/**
 * Tarefas de inicialização para hospedagens sem acesso a terminal (ex.: planos gratuitos):
 * - MIGRAR_AO_INICIAR=true aplica as migrações pendentes (requer MIGRATION_DATABASE_URL);
 * - ADMIN_EMAIL + ADMIN_SENHA_INICIAL criam o primeiro administrador SOMENTE se não houver nenhum usuário.
 *   A senha é provisória: a troca é exigida no primeiro acesso. Remova as variáveis depois.
 */
export async function inicializar() {
  if (process.env.MIGRAR_AO_INICIAR === 'true') {
    if (!config.migrationDatabaseUrl) throw new Error('MIGRAR_AO_INICIAR exige MIGRATION_DATABASE_URL');
    await migrate();
  }
  await verificarPapelSeguro();
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
      'Defina APP_DB_PASSWORD (o papel psidia_app é criado automaticamente) ou APP_DATABASE_URL com um papel sem privilégios.');
  }
}
