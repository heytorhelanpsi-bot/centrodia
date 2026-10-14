import 'dotenv/config';
import crypto from 'node:crypto';


const env = process.env.NODE_ENV ?? 'development';
const naVercel = !!process.env.VERCEL;
const appDbRole = process.env.APP_DB_ROLE ?? 'psidia_app';

/** Conexão principal: DATABASE_URL ou, da integração Vercel/Neon, POSTGRES_URL. */
const urlBase = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const urlProprietarioDireta = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING || '';

function usuarioDe(url: string) {
  try { return decodeURIComponent(new URL(url).username); } catch { return ''; }
}

/**
 * Senha do papel da aplicação: APP_DB_PASSWORD ou, sem ela, derivada (HMAC) da senha do proprietário
 * presente na conexão — assim a integração Neon da Vercel funciona sem nenhuma variável extra.
 */
function senhaAplicacao(): string {
  if (process.env.APP_DB_PASSWORD) return process.env.APP_DB_PASSWORD;
  if (!urlBase || usuarioDe(urlBase) === appDbRole) return '';
  const senhaDono = decodeURIComponent(new URL(urlBase).password || '');
  if (!senhaDono) return '';
  return 'pd_' + crypto.createHmac('sha256', senhaDono).update(`psidia:${appDbRole}`).digest('base64url');
}

/**
 * URL da aplicação (papel sem privilégios de dono). Ordem:
 * 1. APP_DATABASE_URL;
 * 2. se a conexão principal já usa o papel da aplicação, ela própria;
 * 3. senão (conexão do proprietário, ex.: integração Neon), a mesma URL com o papel da aplicação,
 *    que é criado pela migração com a senha de senhaAplicacao().
 */
function urlAplicacao(): string {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL;
  if (!urlBase) return '';
  const senha = senhaAplicacao();
  if (!senha) return urlBase;
  const u = new URL(urlBase);
  u.username = appDbRole;
  u.password = encodeURIComponent(senha);
  return u.toString();
}

/** URL do proprietário (migrações): explícita, a direta da integração ou a principal se for do proprietário. */
function urlMigracao(): string {
  if (urlProprietarioDireta) return urlProprietarioDireta;
  if (urlBase && usuarioDe(urlBase) !== appDbRole) return urlBase;
  return '';
}

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 3000),
  // Conexão usada pela aplicação (papel sem privilégios de dono — RLS se aplica).
  databaseUrl: urlAplicacao(),
  // Conexão do papel proprietário — usada somente para migrações.
  // (DATABASE_URL_UNPOOLED é criada pela integração Neon da Vercel.)
  migrationDatabaseUrl: urlMigracao(),
  appDbRole,
  appDbPassword: senhaAplicacao(),
  // Na Vercel, as migrações rodam sozinhas na primeira requisição.
  migrarAoIniciar: (process.env.MIGRAR_AO_INICIAR ?? (naVercel ? 'true' : 'false')) === 'true',
  // Funções serverless: poucas conexões por instância.
  poolMax: Number(process.env.DB_POOL_MAX ?? (naVercel ? 3 : 10)),
  // Chave de 32 bytes (base64) para cifrar observações restritas.
  // Sem DATA_ENCRYPTION_KEY em produção, a chave é gerada e guardada no banco (área do proprietário)
  // e carregada na inicialização. Em desenvolvimento usa-se uma chave fixa.
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || (env === 'production' ? '' : 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE='),
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
