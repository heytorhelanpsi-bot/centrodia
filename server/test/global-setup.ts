import pg from 'pg';

export default async function setup() {
  const url = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://psidia_owner:owner_dev_pw@localhost:5432/psidia_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  process.env.MIGRATION_DATABASE_URL = url;
  process.env.DATABASE_URL ??= 'postgres://psidia_app:app_dev_pw@localhost:5432/psidia_test';
  const { migrate } = await import('../src/db/migrate.js');
  await migrate(url, process.env.APP_DB_ROLE ?? 'psidia_app');
}
