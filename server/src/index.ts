import { config } from './config.js';
import { criarApp } from './app.js';
import { inicializar } from './lib/inicializacao.js';

await inicializar();
criarApp().listen(config.port, () => {
  console.log(`PsiDia ouvindo na porta ${config.port} (${config.env})`);
});
