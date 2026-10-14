# Deploy gratuito do PsiDia (Render + Neon)

Custo: **R$ 0**. Os relatórios são compilados automaticamente e a IA fica desligada.
Tempo estimado: 20–30 minutos. Não é preciso usar o terminal.

| Peça | Serviço gratuito | O que oferece |
|---|---|---|
| Servidor do app | **Render**, plano Free | HTTPS automático, deploy a partir do GitHub, 750 h/mês |
| Banco de dados | **Neon**, plano Free | PostgreSQL 16 com 0,5 GB (dezenas de milhares de evoluções), histórico de restauração curto |
| Código | **GitHub** (já em uso) | O deploy é refeito a cada atualização do branch `main` |

## Limitações do plano gratuito (leia antes)

- **Hibernação:** o servidor do Render “dorme” após 15 minutos sem uso. O primeiro acesso depois
  disso leva cerca de **1 minuto** para abrir; os seguintes são rápidos. Os dados não se perdem.
- **Backups:** o plano gratuito do Neon só permite restaurar um ponto recente (horas). **Faça uma
  exportação semanal**, conforme a seção 6.
- **Localização dos dados:** para o app ficar rápido, o servidor e o banco ficam na mesma região
  (Estados Unidos, Virgínia). Isso é uma transferência internacional de dados (art. 33 da LGPD).
  Registre essa decisão no inventário de tratamento. Para manter os dados no Brasil, o caminho é
  um plano pago com servidor e banco em São Paulo (veja `PRODUCAO.md`).
- Para uso institucional com muitos usuários simultâneos, planeje migrar para planos pagos
  (cerca de US$ 25–80/mês, conforme `PRODUCAO.md`).

## 1. Juntar o código no branch `main`

O blueprint publica o branch `main`. Faça o merge do branch `claude/reabilita-mais` no `main` pelo GitHub
(Pull request › Merge) ou peça para eu abrir o pull request.

## 2. Criar o banco no Neon

1. Acesse https://neon.tech e entre com a conta Google ou GitHub (plano Free).
2. **Create project:** nome `psidia`, PostgreSQL 16, região **AWS US East (N. Virginia)**.
3. No projeto, abra o **SQL Editor** e execute o comando abaixo, trocando a senha por uma senha forte
   (letras e números, sem aspas):
   ```sql
   CREATE ROLE psidia_app LOGIN PASSWORD 'TROQUE-POR-UMA-SENHA-FORTE';
   ```
   > Importante: crie esse papel **pelo SQL Editor**, e não pela tela “Roles”. Os papéis criados
   > pela tela recebem privilégios administrativos que desativariam a proteção por linha (RLS).
4. Em **Dashboard › Connect**, copie duas URLs de conexão:
   - **URL do proprietário (direta):** papel `neondb_owner`, com a opção *Connection pooling*
     **desligada**. Ela será a `MIGRATION_DATABASE_URL`.
   - **URL da aplicação (com pool):** troque o usuário e a senha da URL com pooling (*Connection
     pooling* **ligada**, endereço com `-pooler`) por `psidia_app` e a senha do passo 3. Ela será a
     `DATABASE_URL`. Formato:
     `postgresql://psidia_app:SENHA@ep-xxxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`

## 3. Criar o app no Render

1. Acesse https://render.com e entre com a conta do **GitHub** (plano Free, sem cartão).
2. **New › Blueprint**, selecione o repositório `centrodia` e confirme. O Render lê o arquivo
   `render.yaml` e cria o serviço `psidia`.
3. Preencha as variáveis pedidas:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | URL da aplicação (passo 2.4) |
   | `MIGRATION_DATABASE_URL` | URL do proprietário (passo 2.4) |
   | `PUBLIC_URL` | `https://psidia.onrender.com` (ou o endereço exibido pelo Render) |
   | `ADMIN_EMAIL` | seu e-mail (primeiro administrador) |
   | `ADMIN_SENHA_INICIAL` | senha provisória com 10+ caracteres, letras e números |
   | `ADMIN_NOME` | seu nome |

4. Clique em **Apply**. O primeiro build leva 3–6 minutos. Nos logs devem aparecer
   “Migração aplicada…”, “Administrador inicial criado…” e “PsiDia ouvindo na porta…”.

## 4. Primeiro acesso

1. Abra o endereço do app, entre com `ADMIN_EMAIL` e a senha provisória e **defina a senha definitiva**.
2. No Render, em **Environment**, **apague** `ADMIN_SENHA_INICIAL` (e `ADMIN_EMAIL`/`ADMIN_NOME`)
   e salve. Elas não são mais necessárias.
3. **Guarde a chave de cifragem:** em **Environment**, copie o valor de `DATA_ENCRYPTION_KEY` e guarde
   em um gerenciador de senhas. Sem ela, as observações restritas não podem ser lidas em uma
   restauração.
4. Siga o checklist de `PRODUCAO.md`: dados da instituição, usuários, permissões, catálogo CID,
   escalas e política de retenção.

## 5. Instalar no celular e no tablet

O PsiDia pode ser instalado como aplicativo, com ícone na tela inicial:
- **Android (Chrome):** abra o endereço › menu ⋮ › **Instalar app** (ou “Adicionar à tela inicial”).
- **iPhone/iPad (Safari):** abra o endereço › Compartilhar › **Adicionar à Tela de Início**.

## 6. Backup semanal gratuito (recomendado)

No computador, com o PostgreSQL client instalado:
```bash
pg_dump "URL-DO-PROPRIETARIO" --format=custom --file=psidia-$(date +%F).dump
```
Guarde o arquivo cifrado (por exemplo, em um volume protegido por senha) em local diferente da chave
de cifragem. Para restaurar: `pg_restore --clean --no-owner -d "URL-DE-UM-BANCO-NOVO" arquivo.dump`.

## Atualizações

Cada merge no branch `main` dispara um novo deploy automático. As migrações de banco são aplicadas
na inicialização (`MIGRAR_AO_INICIAR=true`).

## Ativar a IA no futuro (opcional, com custo)

Defina `AI_ENABLED=true`, `AI_PROVIDER=gemini` e `GEMINI_API_KEY` no Render, conforme `PRODUCAO.md`.
