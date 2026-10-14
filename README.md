# Reabilita+ — Gestão e Evolução dos Assistidos

Aplicativo web responsivo para centros de reabilitação: cadastro de assistidos, registro de
evoluções individuais e em grupo, indicadores comportamentais de 0 a 5 com escalas versionadas,
histórico individual com linha do tempo e gráficos, e minutas de análises e relatórios produzidas
com IA, com revisão humana obrigatória.

> Interface em português do Brasil. Para tablets, celulares e computadores.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Dashboard** | Assistidos ativos, previstos do dia (pela agenda), registrados e pendentes, individuais × grupo, distribuição por turno, evoluções recentes e alertas de rascunhos. Filtros por data, turno e profissional. Não mostra dados clínicos. |
| **Assistidos** | Cadastro com código interno automático (RB-00001), idade calculada, vários diagnósticos/CID (busca no catálogo ou inserção manual autorizada, com a situação documental de cada um), dias e turno, observações restritas **cifradas**. Busca, filtros, arquivamento sem perda de histórico e bloqueio de duplicidade (nome normalizado + data de nascimento). |
| **Registrar evolução** | Formulário em seções: identificação, checklist de atividades (com “Adicionar nova atividade”), indicadores 0–5 com “Não avaliado” separado do 0, descrição de cada nível e observação por indicador, evolução e campos complementares. Botões: salvar rascunho, salvar, salvar e registrar a próxima, salvar e gerar análise com IA, cancelar. |
| **Correções** | Registros finalizados não podem ser alterados sem registro. Correções exigem motivo e guardam as versões anterior e nova (com responsável e data). Isso é garantido **no banco de dados**. |
| **Atendimentos em grupo** | O evento é registrado uma vez, com seleção múltipla de participantes (previstos do dia/turno, filtros e busca) e ausentes. Cada participante tem seu próprio registro, com participação, apoio, indicadores e evolução. A “avaliação comum” exige revisão individual, e evoluções idênticas são recusadas. Cada pessoa recebe uma evolução vinculada ao evento. |
| **Histórico** | Lista geral com filtros (assistido, período, atividade, turno, profissional, tipo, indicador), exportação CSV/XLSX e linha do tempo individual com evoluções, participações em grupo, análises de IA, relatórios e correções. |
| **Indicadores** | Gráficos descritivos por indicador e **por versão de escala**. Lacunas aparecem como “não avaliado” (nunca como zero), o número de observações é sempre mostrado e não há médias. A mediana e a tendência só aparecem com ≥ 4 observações. Inclui um guia das escalas para padronizar a equipe e a configuração de indicadores personalizados (nova versão de escala sem alterar avaliações antigas). |
| **Relatórios** | 8 modelos. **Modo automático, sem IA:** o sistema reúne todas as evoluções e registros do período (atividades e realização, participação, indicadores por versão de escala, comportamentos, apoios, ocorrências, pontos para acompanhamento por regras e anexo cronológico com o texto integral de cada registro), com botão para recompilar depois de novos registros. Também é possível escolher o assistido, o período e os registros. **Com IA (opcional: Gemini ou Claude):** a IA gera uma **minuta** que pode ser editada (cada edição vira uma nova versão), regenerada com instruções, comparada lado a lado com os registros originais e aprovada com confirmação de revisão. O PDF só é gerado após a aprovação. Relatórios de grupo trazem uma síntese geral e anexos individuais com acesso controlado. |
| **Análises com IA** | Análise de uma evolução (7 seções pedidas + lacunas) e análise longitudinal (30/60/90 dias ou período livre) com estatísticas calculadas pelo sistema. Revisão humana obrigatória. |
| **Usuários e configurações** | Usuários, perfis e matriz de permissões, atribuição de assistidos por usuário, links de redefinição de senha, encerramento de sessões, dados institucionais, política de IA e de retenção, auditoria, LGPD (exportação, anonimização e remoção de dados de exemplo) e importação da tabela CID-10. |

## Arquitetura

```
client/   React 18 + Vite + TypeScript (SPA), recharts
server/   Node.js 22 + Express 5 + TypeScript, PostgreSQL 16 (pg), zod, Google GenAI SDK (Gemini) e Anthropic SDK (opcionais)
          src/db/migrations   esquema, RLS, gatilhos e dados iniciais (SQL)
          test/               testes automatizados contra PostgreSQL real
docs/     PRODUCAO.md (implantação, integrações e custos) e LGPD.md
```

Segurança em camadas:

1. **Interface:** mostra só as ações permitidas ao perfil.
2. **API:** verifica a sessão e a permissão em cada rota e valida os dados com zod.
3. **Banco:** a aplicação conecta com um papel **sem privilégios de dono**, sujeito a
   **Row-Level Security**. Cada transação informa o usuário (`app.usuario_id`), e as políticas
   restringem os assistidos ao que foi atribuído, os rascunhos ao autor, o perfil de consulta
   somente à leitura e aos relatórios aprovados, a auditoria somente a inserção, e assim por diante.
   Os gatilhos impedem alterar uma evolução finalizada sem correção registrada, alterar versões
   de escala, apagar a auditoria e reverter um relatório aprovado.

## Executar localmente

Pré-requisitos: Node 22+ e PostgreSQL 14+.

```bash
# 1. Banco e papéis (exemplo; use senhas fortes)
psql -U postgres -c "CREATE ROLE reabilita_owner LOGIN PASSWORD '...'"
psql -U postgres -c "CREATE ROLE reabilita_app LOGIN PASSWORD '...'"
psql -U postgres -c "CREATE DATABASE reabilita OWNER reabilita_owner"

# 2. Configuração
cp server/.env.example server/.env    # preencha as URLs e a DATA_ENCRYPTION_KEY
npm run install:all
npm run migrate

# 3. Primeiro administrador (a senha provisória é exibida uma vez)
npm --prefix server run create-admin -- "Seu Nome" voce@instituicao.org

# 4. (Opcional) dados de demonstração, marcados como exemplo e removíveis
npm --prefix server run seed:demo -- voce@instituicao.org

# 5. Desenvolvimento: API em :3000 e interface em :5173
npm --prefix server run dev
npm --prefix client run dev
```

Para produção, use `npm run build && npm start` (a API também serve a interface compilada) ou o `Dockerfile`.
Veja [docs/PRODUCAO.md](docs/PRODUCAO.md).

## Testes

```bash
npm test             # 45 testes (unidade + fluxos completos) contra um banco PostgreSQL de teste
npm run typecheck
```

Os testes recriam o banco `reabilita_test` (configure `TEST_DATABASE_URL` e
`TEST_MIGRATION_DATABASE_URL` se necessário) e cobrem: cálculo de idade, autenticação, bloqueio
por tentativas, troca obrigatória de senha, CSRF, cadastro e duplicidade, CID, arquivamento,
RLS (inclusive com acesso direto ao banco, contornando a API), evolução (rascunho, validação,
finalização, correção auditada, bloqueio no banco), “Não avaliado” ≠ 0, versionamento de escalas,
pontuação fora da escala, grupos (evoluções idênticas recusadas, revisão individual, visibilidade
por participante), dashboard, exportação, auditoria imutável, IA (sem nome/CPF/diagnóstico não
autorizado no prompt, revisão humana, desativação institucional), relatórios (versões, aprovação,
PDF, perfil de consulta) e LGPD (exportação, anonimização, remoção de exemplos).

A IA é testada com provedores simulados (Gemini e Claude). Uma chamada real exige `GEMINI_API_KEY` ou `ANTHROPIC_API_KEY`. Veja como configurar o Gemini em [docs/PRODUCAO.md](docs/PRODUCAO.md).
