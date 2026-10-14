import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://reabilita_app:app_dev_pw@localhost:5432/reabilita_test',
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://reabilita_owner:owner_dev_pw@localhost:5432/reabilita_test',
      APP_DB_ROLE: 'reabilita_app',
      AI_ENABLED: 'true',
      ANTHROPIC_API_KEY: '',
    },
  },
});
