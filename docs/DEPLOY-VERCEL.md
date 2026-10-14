# Deploy do PsiDia na Vercel (gratuito)

O PsiDia está pronto para a Vercel: a interface é servida como site estático e a API roda como
função serverless (`api/index.js`). O banco é um PostgreSQL **Neon**, criado pelo próprio painel da Vercel.

- **Custo:** R$ 0 (Vercel Hobby + Neon Free). A IA fica desligada e os relatórios são automáticos.
- **Dados no Brasil:** a função roda em São Paulo (`gru1`, definido no `vercel.json`). Escolha
  também São Paulo para o banco.
- **Tempo:** cerca de 15 minutos, sem terminal.

> **Atenção — termos do plano Hobby:** o plano gratuito da Vercel é destinado a uso pessoal e não
> comercial. Para uso institucional contínuo, avalie o plano Pro (US$ 20/mês por membro) ou o deploy
> gratuito alternativo no Render (`DEPLOY-GRATUITO.md`).

## 1. Código no branch principal

A Vercel publica em produção o branch `main`. Faça o merge do branch `claude/reabilita-mais` no `main`
(GitHub › Pull requests).

## 2. Importar o projeto

1. Acesse https://vercel.com/new e escolha o repositório **centrodia** (Import).
2. **Não altere** as configurações de build: o arquivo `vercel.json` já define instalação, build,
   diretório de saída, rotas e região.
3. Ainda **não** clique em Deploy: crie antes o banco e as variáveis (passos 3 e 4). Se já tiver
   clicado, sem problema: o primeiro deploy falhará e basta refazê-lo no fim (passo 5).

## 3. Criar o banco (Neon, pelo painel da Vercel)

1. No projeto, abra **Storage › Create Database › Neon (Serverless Postgres)** › plano **Free**.
2. Região: **São Paulo (South America)**, se disponível. Se não houver, escolha **Washington, D.C.
   (US East)** e troque `"regions": ["gru1"]` por `["iad1"]` no `vercel.json`.
3. Conecte o banco ao projeto (ambientes *Production* e *Preview*). A Vercel cria automaticamente
   as variáveis `DATABASE_URL` e `DATABASE_URL_UNPOOLED`.

## 4. Variáveis de ambiente

Em **Settings › Environment Variables**, adicione (ambiente *Production*):

| Variável | Valor |
|---|---|
| `APP_DB_PASSWORD` | uma senha forte e exclusiva (o app cria o papel `psidia_app` com ela) |
| `DATA_ENCRYPTION_KEY` | chave de 32 bytes em base64 (veja abaixo) |
| `MIGRAR_AO_INICIAR` | `true` |
| `AI_ENABLED` | `false` |
| `ADMIN_EMAIL` | seu e-mail (primeiro administrador) |
| `ADMIN_SENHA_INICIAL` | senha provisória com 10+ caracteres, letras e números |
| `ADMIN_NOME` | seu nome |

**Gerar a `DATA_ENCRYPTION_KEY` sem terminal:** abra o console do navegador (F12 › Console), cole a
linha abaixo e copie o resultado:
```js
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```
**Guarde essa chave em um gerenciador de senhas.** Sem ela, as observações restritas não podem ser
lidas em uma restauração.

Por que `APP_DB_PASSWORD`? A integração Neon fornece a conexão do **proprietário** do banco, que
ignora as regras de acesso por linha (RLS). Com `APP_DB_PASSWORD`, o PsiDia cria o papel
`psidia_app`, sem privilégios, e passa a usá-lo. Se a aplicação for configurada por engano para usar o
proprietário, ela **se recusa a iniciar** e registra o motivo nos logs.

## 5. Deploy

Clique em **Deploy** (ou, em **Deployments**, use **Redeploy** no último deploy). Na primeira
requisição, o app aplica as migrações, cria o papel seguro e o administrador inicial. Confira em
**Logs**: “Papel da aplicação criado”, “Migração aplicada…” e “Administrador inicial criado…”.

## 6. Primeiro acesso

1. Abra `https://<seu-projeto>.vercel.app`, entre com o `ADMIN_EMAIL` e a senha provisória e defina
   a senha definitiva.
2. Em **Environment Variables**, **apague** `ADMIN_SENHA_INICIAL`, `ADMIN_EMAIL` e `ADMIN_NOME` e faça um Redeploy.
3. Siga o checklist de `PRODUCAO.md`: dados da instituição, usuários e permissões, catálogo CID,
   escalas e política de retenção.
4. Instale nos aparelhos: Android (Chrome › ⋮ › Instalar app) ou iPhone/iPad (Safari › Compartilhar ›
   Adicionar à Tela de Início).

## Observações

- **Atualizações:** cada merge no `main` gera um novo deploy. As migrações rodam automaticamente.
- **Desempenho:** depois de um período sem uso, a primeira requisição leva alguns segundos (a função e
  o banco Neon “acordam”).
- **Backup:** o plano Free do Neon tem histórico curto. Exporte semanalmente (o comando `pg_dump` está em
  `DEPLOY-GRATUITO.md`), usando a URL `DATABASE_URL_UNPOOLED`.
- **Limites do plano gratuito:** PDF, relatórios e exportações rodam dentro do tempo máximo da função
  (60 s). Importações de arquivos CID maiores que 4 MB devem ser divididas em partes.
