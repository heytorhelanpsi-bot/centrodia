import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 3000),
  // Conexão usada pela aplicação (papel sem privilégios de dono — RLS se aplica).
  databaseUrl: req('DATABASE_URL'),
  // Conexão do papel proprietário — usada somente para migrações.
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL ?? '',
  appDbRole: process.env.APP_DB_ROLE ?? 'reabilita_app',
  // Chave de 32 bytes (base64) para cifrar observações restritas.
  dataEncryptionKey: req('DATA_ENCRYPTION_KEY', env === 'production' ? undefined : 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE='),
  // Provedor de IA: 'anthropic' | 'gemini' | vazio (detecta pela chave configurada).
  aiProvider: (process.env.AI_PROVIDER ?? '').toLowerCase(),
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
  aiEnabled: (process.env.AI_ENABLED ?? 'true') !== 'false',
  cookieSecure: (process.env.COOKIE_SECURE ?? (env === 'production' ? 'true' : 'false')) === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
};
