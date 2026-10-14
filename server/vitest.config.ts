import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://psidia_app:app_dev_pw@localhost:5432/psidia_test',
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://psidia_owner:owner_dev_pw@localhost:5432/psidia_test',
      APP_DB_ROLE: process.env.APP_DB_ROLE ?? 'psidia_app',
      AI_ENABLED: 'true',
      ANTHROPIC_API_KEY: '',
    },
  },
});
