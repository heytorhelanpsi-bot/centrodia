# Colocando o Reabilita+ em produção

## 1. Componentes necessários

| Componente | Função | Opções |
|---|---|---|
| Servidor de aplicação (Node 22) | API + interface compilada (um único processo) | VPS com Docker, Render, Railway, Fly.io, AWS/GCP/Azure. **Prefira região Brasil** (ex.: São Paulo). |
| PostgreSQL 14+ gerenciado | Dados persistentes, RLS, backups | AWS RDS, Google Cloud SQL, Azure Database, Supabase, Neon, ou PostgreSQL próprio com backup |
| HTTPS | Proteção em trânsito | Proxy do provedor ou Nginx/Caddy com Let's Encrypt (gratuito) |
| IA (opcional) | Minutas em texto corrido e análises com IA | **Google Gemini** (chave do Google AI Studio) **ou** Anthropic Claude. Chave somente no servidor |

Não há outras integrações externas. O sistema **não envia e-mails**: a recuperação de conta usa
links de uso único emitidos pela administração (válidos por 24 h). Uma integração de e-mail pode
ser adicionada depois, se desejado.

## 2. Banco de dados

1. Crie dois papéis:
   - `reabilita_owner`: dono do banco; usado **somente** para migrações.
   - `reabilita_app`: usado pela aplicação; **não** pode ser dono das tabelas (é isso que faz a RLS valer).
2. `CREATE DATABASE reabilita OWNER reabilita_owner;`
3. Rode as migrações: `MIGRATION_DATABASE_URL=... APP_DB_ROLE=reabilita_app npm --prefix server run migrate:prod`
   (ou `npm run migrate` em desenvolvimento). As migrações concedem ao papel da aplicação apenas
   os privilégios necessários: não há `DELETE` em tabelas clínicas, e a auditoria só aceita inserção.
4. Exija TLS na conexão (`?sslmode=require` na URL) e cifragem em repouso (padrão nos serviços gerenciados).

### Backups e recuperação
- Ative os backups automáticos diários com recuperação pontual (PITR) e retenção de pelo menos 30 dias.
- Faça um `pg_dump` cifrado semanal, armazenado em outro provedor ou outra conta.
- **Teste a restauração** pelo menos a cada trimestre, num banco separado, e registre o teste.
- Guarde a `DATA_ENCRYPTION_KEY` num cofre de segredos separado dos backups. Sem ela, as
  observações restritas não podem ser lidas; com ela junto do backup, a cifragem perde o sentido.

## 3. Variáveis de ambiente (server)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | sim | `production` |
| `DATABASE_URL` | sim | conexão do papel `reabilita_app` |
| `MIGRATION_DATABASE_URL` | p/ migrar | conexão do papel `reabilita_owner` |
| `APP_DB_ROLE` | sim | nome do papel da aplicação (padrão `reabilita_app`) |
| `DATA_ENCRYPTION_KEY` | sim | 32 bytes em base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PUBLIC_URL` | sim | URL pública (usada nos links de redefinição de senha) |
| `COOKIE_SECURE` | sim | `true` (exige HTTPS) |
| `TRUST_PROXY` | conforme | `true` se houver proxy/balanceador à frente (IPs corretos na auditoria e no limite de tentativas) |
| `AI_PROVIDER` | não | `gemini` ou `anthropic`. Vazio: usa o provedor cuja chave estiver definida |
| `GEMINI_API_KEY` | não | habilita o Google Gemini |
| `GEMINI_MODEL` | não | padrão `gemini-2.5-pro` (confira os modelos disponíveis em ai.google.dev; `gemini-2.5-flash` é mais barato) |
| `ANTHROPIC_API_KEY` | não | habilita o Claude |
| `ANTHROPIC_MODEL` | não | padrão `claude-opus-5-5` |
| `AI_ENABLED` | não | `false` desliga a IA no servidor, independentemente da chave |

Sem nenhuma chave de IA, o sistema funciona por completo: os relatórios são **compilados automaticamente**
a partir dos registros, e só os botões de redação com IA ficam desabilitados.

A chave da API nunca é enviada ao navegador. Todas as chamadas à IA saem do backend.

## 4. Implantação com Docker

```bash
docker build -t reabilita .
docker run -d --env-file server/.env -p 3000:3000 reabilita
# Migrações (uma vez por versão):
docker run --rm --env-file server/.env reabilita node server/dist/db/migrate.js
# Primeiro administrador:
docker run --rm -it --env-file server/.env reabilita node server/dist/scripts/create-admin.js "Nome" email@instituicao.org
```

Coloque um proxy HTTPS (Caddy, Nginx ou o do provedor) à frente da porta 3000.

## 5. Checklist antes de liberar para a equipe

- [ ] HTTPS ativo e `COOKIE_SECURE=true`
- [ ] Banco com backup automático, PITR e um teste de restauração feito
- [ ] `DATA_ENCRYPTION_KEY` única, guardada em cofre
- [ ] Primeiro administrador criado e senha provisória trocada
- [ ] Dados institucionais preenchidos (aparecem nos relatórios)
- [ ] Perfis e permissões revisados conforme as funções reais da equipe
- [ ] Usuários criados com “Acesso a todos os assistidos” **desmarcado**, salvo necessidade, e assistidos atribuídos
- [ ] Tabela CID-10 oficial importada (Configurações › Catálogo CID). O sistema traz só um catálogo inicial parcial
- [ ] Descrições das escalas revisadas pela equipe técnica (Indicadores › Configuração)
- [ ] Política de retenção definida (Configurações › Instituição, IA e retenção)
- [ ] Decisão documentada sobre o uso de IA (ver `LGPD.md`); se não aprovado, desabilitar em Configurações
- [ ] Dados de demonstração removidos (Configurações › LGPD)
- [ ] Orientação da equipe sobre registros objetivos e a revisão das minutas de IA

## 6. Custos previstos (estimativas de outubro de 2026, em dólares; confirme nos sites dos provedores)

### Infraestrutura
| Item | Faixa mensal típica |
|---|---|
| Servidor de aplicação (1 vCPU, 1–2 GB) | US$ 7 – 25 |
| PostgreSQL gerenciado pequeno com backup | US$ 15 – 50 |
| Armazenamento de backups externos | US$ 1 – 5 |
| Domínio | ~US$ 1 (anual diluído) |
| Certificado HTTPS | gratuito (Let's Encrypt) |
| **Total sem IA** | **~US$ 25 – 80/mês** |

### Relatórios automáticos
Sem custo adicional: o sistema compila o relatório a partir dos registros, sem chamar serviços externos.

### IA com Google Gemini (opcional, cobrança por uso)

**Importante:** a assinatura do app Gemini (Google AI Pro) é cobrada separadamente da **API**, que é o
que o sistema usa. Para usar o Gemini aqui:
1. Acesse https://aistudio.google.com com a conta Google da instituição e crie uma chave de API (“Get API key”).
2. **Ative o faturamento (nível pago) no projeto do Google Cloud vinculado à chave.** No nível gratuito,
   os termos do Google permitem usar o conteúdo enviado para melhorar os produtos, o que é inadequado
   para dados de saúde. No nível pago, o conteúdo não é usado para isso (confirme nos termos vigentes).
   Para exigências maiores (contrato, região de dados), use o Gemini via Vertex AI.
3. No servidor: `AI_PROVIDER=gemini` e `GEMINI_API_KEY=<chave>`. Reinicie o servidor.
4. Em Configurações › Instituição, IA e retenção, confirme a indicação “Configurada — Google (Gemini)”.

Custo de referência (confirme em ai.google.dev/pricing): o `gemini-2.5-pro` custa cerca de US$ 1,25
por milhão de tokens de entrada e US$ 10 por milhão de saída; o `gemini-2.5-flash` custa cerca de
US$ 0,30 e US$ 2,50. No cenário abaixo (40 relatórios e 200 análises por mês), o custo fica na faixa de
**US$ 5 – 15/mês** com o Pro e de **menos de US$ 3/mês** com o Flash.

### IA com Claude (opcional, cobrança por uso)
Preço do modelo padrão `claude-opus-5-5`: US$ 4 por milhão de tokens de entrada e
US$ 20 por milhão de tokens de saída (inclui o raciocínio do modelo).

| Operação | Tokens aproximados | Custo aproximado |
|---|---|---|
| Análise de uma evolução | 3 mil de entrada + 2–4 mil de saída | US$ 0,05 – 0,09 |
| Análise longitudinal (30 dias, ~15 registros) | 12 mil + 4–6 mil | US$ 0,10 – 0,17 |
| Relatório mensal (~20 registros) | 15 mil + 5–8 mil | US$ 0,16 – 0,22 |
| Relatório semestral (~100 registros) | 60 mil + 8–12 mil | US$ 0,40 – 0,50 |

Exemplo: 40 assistidos, 1 relatório mensal para cada e 200 análises de evolução por mês resultam
em cerca de **US$ 20 – 30/mês**.
Para reduzir o custo, defina `ANTHROPIC_MODEL=claude-sonnet-5-5` (US$ 2/US$ 10 por milhão,
aproximadamente metade do custo). Avalie antes a qualidade das minutas com a equipe.
Defina um limite de gastos no console da Anthropic.

## 7. Operação

- **Atualizações:** faça o backup, rode as migrações e reinicie o processo.
- **Logs:** o servidor registra erros internos no stdout, sem conteúdo clínico. A trilha de uso
  (acessos, exportações, alterações, uso de IA) fica na tabela `auditoria`, consultável em Configurações › Auditoria.
- **Sessões:** expiram após 30 minutos de inatividade ou 12 horas no total. Cinco senhas
  erradas bloqueiam a conta por 15 minutos.
- **Monitoramento:** use `GET /api/saude` para a verificação de disponibilidade.
