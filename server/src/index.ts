import { config } from './config.js';
import { criarApp } from './app.js';

criarApp().listen(config.port, () => {
  console.log(`Reabilita+ API ouvindo na porta ${config.port} (${config.env})`);
});
