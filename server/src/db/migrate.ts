import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(url = config.migrationDatabaseUrl, appRole = config.appDbRole) {
  if (!url) throw new Error('MIGRATION_DATABASE_URL não definida');
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error('APP_DB_ROLE inválido');
  const dir = path.resolve(here, 'migrations');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Evita migrações simultâneas (várias instâncias serverless iniciando ao mesmo tempo).
    await client.query('SELECT pg_advisory_lock(727274)');
    await garantirPapelAplicacao(client, appRole);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    const feitas = new Set((await client.query('SELECT nome FROM schema_migrations')).rows.map((r) => r.nome));
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of arquivos) {
      if (feitas.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').replaceAll('{{APP_ROLE}}', appRole);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`Migração aplicada: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${f}: ${(e as Error).message}`);
      }
    }
    // O papel da aplicação existe? Então (re)aplica seus privilégios.
    if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole])).rowCount) {
      const priv = fs.readFileSync(path.resolve(here, 'privilegios.sql'), 'utf8').replaceAll('{{APP_ROLE}}', appRole);
      await client.query(priv);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
}

/** Com APP_DB_PASSWORD definido, cria (ou atualiza a senha do) papel da aplicação, sem privilégios de dono. */
async function garantirPapelAplicacao(client: pg.Client, appRole: string) {
  const senha = config.appDbPassword;
  if (!senha) return;
  const existe = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole])).rowCount;
  const cmd = await client.query(
    `SELECT format($1, $2::text, $3::text) AS sql`,
    [existe ? 'ALTER ROLE %I WITH LOGIN PASSWORD %L' : 'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', appRole, senha]);
  await client.query(cmd.rows[0].sql);
  if (!existe) console.log(`Papel da aplicação criado: ${appRole}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => console.log('Migrações concluídas.')).catch((e) => { console.error(e.message); process.exit(1); });
}
