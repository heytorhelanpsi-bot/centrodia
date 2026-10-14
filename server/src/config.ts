import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';
const naVercel = !!process.env.VERCEL;
const appDbRole = process.env.APP_DB_ROLE ?? 'psidia_app';

/**
 * URL da aplicação (papel sem privilégios de dono). Ordem:
 * 1. APP_DATABASE_URL;
 * 2. com APP_DB_PASSWORD: a URL de DATABASE_URL (ex.: criada pela integração Neon da Vercel) com o
 *    usuário trocado pelo papel da aplicação — que é criado pela migração;
 * 3. DATABASE_URL.
 */
function urlAplicacao(): string {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL;
  const base = req('DATABASE_URL');
  if (!process.env.APP_DB_PASSWORD) return base;
  const u = new URL(base);
  u.username = appDbRole;
  u.password = encodeURIComponent(process.env.APP_DB_PASSWORD);
  return u.toString();
}

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 3000),
  // Conexão usada pela aplicação (papel sem privilégios de dono — RLS se aplica).
  databaseUrl: urlAplicacao(),
  // Conexão do papel proprietário — usada somente para migrações.
  // (DATABASE_URL_UNPOOLED é criada pela integração Neon da Vercel.)
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? '',
  appDbRole,
  appDbPassword: process.env.APP_DB_PASSWORD ?? '',
  // Funções serverless: poucas conexões por instância.
  poolMax: Number(process.env.DB_POOL_MAX ?? (naVercel ? 3 : 10)),
  // Chave de 32 bytes (base64) para cifrar observações restritas.
  dataEncryptionKey: req('DATA_ENCRYPTION_KEY', env === 'production' ? undefined : 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE='),
  // Provedor de IA: 'anthropic' | 'gemini' | vazio (detecta pela chave configurada).
  aiProvider: (process.env.AI_PROVIDER ?? '').toLowerCase(),
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
  aiEnabled: (process.env.AI_ENABLED ?? 'true') !== 'false',
  cookieSecure: (process.env.COOKIE_SECURE ?? (env === 'production' ? 'true' : 'false')) === 'true',
  trustProxy: (process.env.TRUST_PROXY ?? (naVercel ? 'true' : 'false')) === 'true',
  publicUrl: process.env.PUBLIC_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173'),
};
