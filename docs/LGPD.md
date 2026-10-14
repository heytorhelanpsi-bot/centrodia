# Privacidade e LGPD — o que o sistema faz e o que a instituição precisa decidir

O PsiDia trata **dados pessoais sensíveis** (saúde, deficiência, diagnósticos e comportamento)
de pessoas que podem ser crianças, adolescentes ou adultos em situação de vulnerabilidade. Este
documento descreve as salvaguardas técnicas implementadas e as decisões que cabem à instituição,
com orientação jurídica. **Ele não substitui um parecer jurídico.**

## Salvaguardas implementadas

| Requisito | Implementação |
|---|---|
| Autenticação segura | Senhas com bcrypt (custo 12), política mínima, troca obrigatória da senha provisória, bloqueio após 5 tentativas, cookie de sessão `HttpOnly` + `SameSite=Strict` + `Secure`, expiração por inatividade (30 min) e duração máxima (12 h), encerramento de sessões pela administração |
| Recuperação de conta | Link de uso único, válido por 24 h, emitido pela administração e registrado na auditoria. As sessões anteriores são encerradas após a redefinição |
| Controle de acesso por função | Perfis Administração / Profissional / Consulta com matriz de permissões configurável. O perfil de consulta não pode receber permissões de escrita |
| Acesso mínimo necessário | Por padrão, cada usuário vê somente os assistidos atribuídos a ele (ou cadastrados por ele). O acesso amplo é uma opção explícita por usuário |
| Verificação no backend e no banco | Permissões verificadas em cada rota **e** por Row-Level Security no PostgreSQL. A aplicação usa um papel sem privilégios de dono |
| Proteção em trânsito | HTTPS obrigatório em produção (HSTS) e TLS na conexão com o banco |
| Proteção em repouso | Cifragem do disco do banco gerenciado, mais cifragem AES-256-GCM das observações restritas no nível da aplicação |
| Auditoria | Registro de logins (inclusive falhas), acessos a fichas, evoluções, históricos e relatórios, exportações, alterações, correções, uso de IA e mudanças de permissões. A tabela só aceita inserção |
| Integridade dos registros | Evoluções finalizadas são imutáveis sem correção registrada (motivo, autor, data e versões anterior e nova). Relatórios aprovados não podem ser alterados. Versões de escala são imutáveis |
| Exposição em links públicos | Não existem links públicos: todo conteúdo exige sessão. Arquivos exportados são gerados sob demanda e não ficam armazenados |
| Indexação | `robots.txt` bloqueia tudo, cabeçalho `X-Robots-Tag: noindex` e meta `noindex` |
| Chaves de API | Somente no servidor (variáveis de ambiente). Nunca chegam ao navegador |
| CSRF / clickjacking / XSS | Cookie `SameSite=Strict`, cabeçalho anti-CSRF obrigatório, CSP restritiva, `frame-ancestors 'none'` e renderização de Markdown sem HTML arbitrário |
| Exportação CSV | Proteção contra injeção de fórmulas |

## Relatórios sem IA

O modo **automático** compila os relatórios inteiramente no servidor da instituição, sem enviar dados a terceiros. É a opção padrão e não depende das decisões abaixo.

## Uso de IA (opcional)

O que o sistema faz:
- Chama a IA **somente pelo backend** e **somente** com os registros que o profissional selecionou.
- **Pseudonimiza** os dados antes do envio: o nome do assistido vira `[ASSISTIDO]`, os nomes de
  outros assistidos visíveis viram `[OUTRO ASSISTIDO]` e os nomes de profissionais viram `[PROFISSIONAL]`.
  CPF, telefones e e-mails encontrados nos textos são removidos. A data de nascimento não é enviada,
  apenas a idade. Diagnósticos só são enviados quando o profissional marca essa opção explicitamente.
- O resultado é sempre uma **minuta**: exige revisão e aprovação humanas, fica identificado como texto
  da IA e guarda o modelo, a versão do prompt, a data e o responsável pela aprovação.
- A instituição pode desligar a IA em Configurações, e o servidor pode desligá-la com `AI_ENABLED=false`.

Limitações honestas:
- A pseudonimização reduz o risco, mas não é anonimização. Textos livres podem conter informações
  indiretamente identificáveis, como apelidos, nomes de familiares, endereços ou situações únicas.
  Oriente a equipe a não registrar dados identificadores desnecessários nos campos de texto.
- Nomes de pessoas que não são assistidos nem usuários do sistema (familiares, por exemplo)
  não são reconhecidos automaticamente.

Decisões da instituição **antes de habilitar a IA**:
1. Avaliar o contrato e os termos do provedor escolhido (Google ou Anthropic): tratamento de dados,
   retenção, uso para treinamento e transferência internacional de dados (art. 33 da LGPD).
   - **Google Gemini:** use somente uma chave de um projeto **com faturamento ativo** (nível pago) ou o Vertex AI.
     No nível gratuito, os termos permitem usar o conteúdo para melhorar os produtos do Google.
   - **Anthropic:** por padrão, os dados enviados pela API comercial não são usados para treinar modelos.
   - Confirme sempre nos termos vigentes.
2. Registrar o tratamento no inventário (ROPA) e, dado o risco, elaborar o **Relatório de Impacto
   à Proteção de Dados (RIPD)**.
3. Definir a base legal aplicável. Para dados sensíveis, o art. 11 da LGPD prevê hipóteses como a
   tutela da saúde por profissionais de saúde e o cumprimento de obrigação legal ou regulatória.
   **O consentimento não é a única base possível**, e a escolha deve ser feita com orientação jurídica.
4. Informar os titulares e responsáveis legais de forma clara, inclusive sobre o uso de ferramentas automatizadas de apoio.
5. Não utilizar os dados para treinamento de modelos sem base legal e autorização apropriadas.

## Direitos dos titulares (Configurações › LGPD)

| Direito | Como atender |
|---|---|
| Confirmação e acesso | Exportação completa em JSON (cadastro, agenda, diagnósticos, evoluções, correções, análises e relatórios) |
| Correção | Edição do cadastro (auditada). Evoluções são corrigidas com histórico |
| Portabilidade | Mesma exportação JSON (formato estruturado) |
| Eliminação ou anonimização | Anonimização do cadastro: nome substituído, data de nascimento reduzida ao ano, observações restritas apagadas e cadastro arquivado. Os registros técnicos são mantidos em razão das obrigações de guarda documental. **Revise manualmente os textos livres**, que podem conter identificadores |
| Informação sobre compartilhamento | O único compartilhamento técnico previsto é o envio pseudonimizado ao provedor de IA, quando habilitado |

## Retenção e descarte

Defina o prazo de guarda com a assessoria jurídica e conforme as normas dos conselhos profissionais
envolvidos. Registre-o em Configurações › Instituição, IA e retenção. A tela LGPD lista os cadastros
arquivados com prazo vencido para decisão sobre a anonimização.

## Responsabilidades

- **Controlador:** a instituição. Deve nomear o encarregado (DPO) e publicar o canal de contato.
- **Operadores:** provedores de hospedagem, banco de dados e IA. É preciso ter contratos com cláusulas de proteção de dados.
- **Equipe:** acesso individual (nunca compartilhar contas), registros objetivos e revisão das minutas de IA.
- **Incidentes:** mantenha um plano de resposta. A auditoria e os logs ajudam a delimitar o escopo,
  e a comunicação à ANPD e aos titulares deve ocorrer conforme a regulamentação.
