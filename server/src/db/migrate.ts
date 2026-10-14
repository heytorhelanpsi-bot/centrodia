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
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => console.log('Migrações concluídas.')).catch((e) => { console.error(e.message); process.exit(1); });
}
