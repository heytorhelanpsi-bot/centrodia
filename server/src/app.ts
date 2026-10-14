import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { carregarSessao, exigirLogin, exigirSenhaAtualizada } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { authRouter } from './routes/auth.js';
import { assistidosRouter } from './routes/assistidos.js';
import { atividadesRouter, cidRouter, indicadoresRouter } from './routes/configuracao.js';
import { evolucoesRouter } from './routes/evolucoes.js';
import { coletivasRouter } from './routes/coletivas.js';
import { iaRouter } from './routes/ia.js';
import { relatoriosRouter } from './routes/relatorios.js';
import { dashboardRouter, exportacaoRouter, historicoRouter } from './routes/painel.js';
import { auditoriaRouter, configRouter, lgpdRouter, permissoesRouter, usuariosRouter } from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function criarApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  // Nenhuma página deve ser indexada por mecanismos de busca.
  app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

  app.use(express.json({ limit: '6mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Proteção CSRF complementar ao cookie SameSite=Strict: exige cabeçalho personalizado em operações de escrita.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'psidia') {
      throw new HttpError(403, 'Requisição recusada (cabeçalho de segurança ausente).');
    }
    next();
  });
  api.use(carregarSessao);
  api.get('/saude', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use(exigirLogin, exigirSenhaAtualizada);
  api.use('/dashboard', dashboardRouter);
  api.use('/assistidos', historicoRouter);
  api.use('/assistidos', assistidosRouter);
  api.use('/cid', cidRouter);
  api.use('/atividades', atividadesRouter);
  api.use('/indicadores', indicadoresRouter);
  api.use('/evolucoes', evolucoesRouter);
  api.use('/coletivas', coletivasRouter);
  api.use('/ia', iaRouter);
  api.use('/relatorios', relatoriosRouter);
  api.use('/exportar', exportacaoRouter);
  api.use('/usuarios', usuariosRouter);
  api.use('/permissoes', permissoesRouter);
  api.use('/config', configRouter);
  api.use('/auditoria', auditoriaRouter);
  api.use('/lgpd', lgpdRouter);
  api.use((_req, _res) => { throw new HttpError(404, 'Rota não encontrada.'); });
  app.use('/api', api);

  // Frontend compilado (produção).
  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(tratarErro);
  return app;
}

function tratarErro(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ erro: err.message, detalhes: err.detalhes });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Corpo da requisição inválido.' });
  // Erros do banco com mensagem segura para o usuário.
  switch (err?.code) {
    case 'P0001': return res.status(409).json({ erro: err.message });
    case '23505': return res.status(409).json({ erro: mensagemDuplicidade(err.constraint) });
    case '23503': return res.status(400).json({ erro: 'Referência inválida (registro relacionado inexistente).' });
    case '23514': return res.status(400).json({ erro: 'Valor fora das regras permitidas.' });
    case '42501': return res.status(403).json({ erro: 'Operação não permitida para o seu perfil de acesso.' });
    case '22P02': return res.status(400).json({ erro: 'Valor em formato inválido.' });
  }
  console.error(`[erro] ${req.method} ${req.path}`, err);
  res.status(500).json({ erro: 'Erro interno. A equipe técnica foi notificada; tente novamente.' });
}

function mensagemDuplicidade(constraint?: string) {
  if (constraint === 'assistidos_duplicidade_unq') return 'Já existe um cadastro com o mesmo nome e data de nascimento. Verifique antes de continuar.';
  if (constraint === 'usuarios_email_unq') return 'Já existe um usuário com este e-mail.';
  if (constraint === 'atividades_nome_unq') return 'Já existe uma atividade com este nome.';
  if (constraint === 'cid_codigos_pkey') return 'Este código CID já está cadastrado.';
  return 'Registro duplicado.';
}
