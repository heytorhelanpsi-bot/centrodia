// Função serverless da Vercel: toda requisição /api/* é atendida pela API Express do PsiDia.
// O código do servidor é compilado no build (npm run build → server/dist).
import { criarApp } from '../server/dist/app.js';
import { inicializar } from '../server/dist/lib/inicializacao.js';

const app = criarApp();
let pronto = null;

/** Restaura o caminho original (/api/...) caso a reescrita da Vercel o tenha passado como parâmetro. */
function restaurarCaminho(req) {
  const u = new URL(req.url, 'http://local');
  if (!u.searchParams.has('caminho')) return;
  const caminho = u.searchParams.get('caminho');
  u.searchParams.delete('caminho');
  const base = u.pathname.startsWith('/api/') ? u.pathname : `/api/${caminho}`;
  req.url = base + (u.search || '');
}

export default async function handler(req, res) {
  restaurarCaminho(req);
  // Migrações, verificação de segurança e administrador inicial: uma vez por instância.
  pronto ??= inicializar().catch((e) => { pronto = null; throw e; });
  try {
    await pronto;
  } catch (e) {
    console.error('[inicialização]', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ erro: 'O servidor não está configurado corretamente. A administração deve verificar os logs da Vercel.' }));
    return;
  }
  return app(req, res);
}
