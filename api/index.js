// Função serverless da Vercel: toda requisição /api/* é atendida pela API Express do PsiDia.
// O código do servidor é compilado no build (npm run build → server/dist).

let app = null;
let pronto = null;

/** Carrega a API e executa a inicialização uma vez por instância (migrações, chave, segurança). */
async function preparar() {
  const [{ criarApp }, { inicializar }] = await Promise.all([
    import('../server/dist/app.js'),
    import('../server/dist/lib/inicializacao.js'),
  ]);
  await inicializar();
  app = criarApp();
}

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
  pronto ??= preparar().catch((e) => { pronto = null; throw e; });
  try {
    await pronto;
  } catch (e) {
    console.error('[inicialização]', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ erro: `O servidor não está pronto: ${e instanceof Error ? e.message : 'erro de configuração'}` }));
    return;
  }
  return app(req, res);
}
