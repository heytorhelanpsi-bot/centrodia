# Deploy do PsiDia na Vercel (gratuito, sem variáveis)

O deploy funciona como o do PsicoMeet, com um passo a mais: conectar o banco de dados com um clique.
**Não é preciso preencher nenhuma variável de ambiente.**

- **Custo:** R$ 0 (Vercel Hobby + Neon Free). A IA fica desligada e os relatórios são automáticos.
- **Tempo:** cerca de 10 minutos, pelo navegador (funciona também no celular).

> **Termos do plano Hobby:** o plano gratuito da Vercel é destinado a uso pessoal e não comercial.
> Para uso institucional contínuo, avalie o plano Pro ou o deploy no Render (`DEPLOY-GRATUITO.md`).

## Passo 1 — Importar o repositório

1. Acesse https://vercel.com/new.
2. Em **Import Git Repository**, escolha **centrodia** › **Import**.
3. Não altere nada nas configurações (o `vercel.json` do repositório já define tudo) e clique em **Deploy**.

O primeiro deploy fica pronto, mas o app ainda mostra “O servidor não está pronto: Banco de dados não
conectado”. Isso é esperado: falta o banco.

## Passo 2 — Conectar o banco (1 clique)

1. No projeto, abra a aba **Storage** › **Create Database** › **Neon** (Serverless Postgres) › **Continue**.
2. Plano **Free**. Região: **São Paulo** (ou a mais próxima disponível) › **Create**.
3. Na tela seguinte, confirme a conexão com o projeto (**Connect**), com os ambientes marcados.

## Passo 3 — Publicar de novo

1. Abra a aba **Deployments**, toque nos **⋯** do último deploy › **Redeploy**.
2. Quando terminar, abra o endereço do projeto (`https://<projeto>.vercel.app`).

## Passo 4 — Primeiro acesso

O PsiDia abre a tela **“Crie a conta de administração”**. Preencha seu nome, e-mail e senha.
Essa conta terá acesso total e poderá cadastrar a equipe em **Usuários e configurações**.

> Faça isso logo após o deploy: a tela só aparece enquanto nenhum usuário existir e, depois do
> primeiro cadastro, fica bloqueada.

Depois, siga o checklist de `PRODUCAO.md`: dados da instituição, usuários e permissões, catálogo CID,
escalas e política de retenção. Para instalar nos aparelhos: Android (Chrome › ⋮ › Instalar app) ou
iPhone/iPad (Safari › Compartilhar › Adicionar à Tela de Início).

## O que acontece automaticamente

Na primeira requisição, o app:
- aplica as migrações do banco;
- cria o papel de banco `psidia_app`, sem privilégios, e passa a usá-lo, de modo que as regras de
  acesso por linha (RLS) sempre valem. A senha desse papel é derivada da conexão criada pela Vercel;
- gera a chave de cifragem das observações restritas e a guarda numa tabela que o app comum não
  consegue ler.

Se algo estiver errado, o app responde “O servidor não está pronto: …” com o motivo, e o detalhe
aparece em **Logs** na Vercel.

## Opcional (mais segurança)

Em **Settings › Environment Variables** você pode definir:

| Variável | Para quê |
|---|---|
| `DATA_ENCRYPTION_KEY` | Guardar a chave de cifragem fora do banco (32 bytes em base64). Defina **antes** do primeiro uso: trocar depois torna ilegíveis as observações já cifradas. |
| `APP_DB_PASSWORD` | Usar uma senha própria para o papel `psidia_app`. |

## Observações

- **Atualizações:** cada mudança no branch `main` gera um novo deploy, e as migrações rodam sozinhas.
- **Desempenho:** após um período sem uso, a primeira requisição leva alguns segundos.
- **Backup:** o plano Free do Neon tem histórico curto. Exporte semanalmente com
  `pg_dump "<DATABASE_URL_UNPOOLED>" --format=custom --file=psidia.dump` (a URL está em Storage › Neon › .env.local).
- **Região:** a função roda em São Paulo (`gru1`, em `vercel.json`). Se o banco ficar em outra região,
  troque para a região correspondente (ex.: `iad1` para US East) para reduzir a latência.
