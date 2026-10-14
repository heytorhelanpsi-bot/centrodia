-- Dados de configuração iniciais (não são dados de assistidos).

INSERT INTO permissoes_perfil (perfil, permissao)
SELECT 'admin', p FROM unnest(ARRAY[
  'assistidos.ver','assistidos.editar','assistidos.arquivar','assistidos.observacoes_restritas',
  'evolucoes.registrar','evolucoes.corrigir','evolucoes.editar_data','coletivas.registrar',
  'ia.gerar','relatorios.elaborar','relatorios.aprovar','relatorios.ver_aprovados','exportar',
  'cid.inserir_manual','atividades.criar','config.atividades','config.indicadores',
  'usuarios.gerenciar','auditoria.ver','lgpd.gerenciar']) p;

INSERT INTO permissoes_perfil (perfil, permissao)
SELECT 'profissional', p FROM unnest(ARRAY[
  'assistidos.ver','assistidos.editar','assistidos.observacoes_restritas',
  'evolucoes.registrar','evolucoes.corrigir','evolucoes.editar_data','coletivas.registrar',
  'ia.gerar','relatorios.elaborar','relatorios.aprovar','relatorios.ver_aprovados','exportar',
  'atividades.criar']) p;

INSERT INTO permissoes_perfil (perfil, permissao)
SELECT 'consulta', p FROM unnest(ARRAY['assistidos.ver','relatorios.ver_aprovados']) p;

INSERT INTO configuracoes (chave, valor) VALUES
  ('instituicao', '{"nome": "Centro de Reabilitação", "endereco": "", "cnpj": "", "responsavel_tecnico": ""}'),
  ('ia', '{"habilitada": true, "enviar_nome": false}'),
  ('retencao', '{"descricao": "Definir com assessoria jurídica e conselhos profissionais o prazo de guarda dos registros. Após o prazo, os dados devem ser anonimizados ou eliminados conforme a política institucional.", "prazo_anos": null}');

INSERT INTO atividades (nome, categoria, padrao) VALUES
  ('Atividade pedagógica', 'Pedagógica', true),
  ('Educação física', 'Corporal', true),
  ('Musicoterapia', 'Artística/Terapêutica', true),
  ('Atividade ao ar livre', 'Recreativa', true),
  ('Passeio externo', 'Socialização', true),
  ('Capoeira', 'Corporal', true),
  ('Dança', 'Artística/Corporal', true),
  ('Outra atividade', 'Geral', true);

-- Indicadores padrão e versão 1 das escalas.
WITH ind AS (
  INSERT INTO indicadores (chave, nome, descricao, tipo, padrao, ordem) VALUES
    ('atencao', 'Atenção', 'Capacidade de direcionar e manter a atenção às propostas durante o período observado.', 'positivo', true, 10),
    ('engajamento', 'Engajamento', 'Grau de envolvimento e participação ativa nas propostas.', 'positivo', true, 20),
    ('foco', 'Foco na atividade', 'Permanência na tarefa proposta até sua conclusão ou encerramento.', 'positivo', true, 30),
    ('interacao_social', 'Interação social', 'Iniciativa e resposta em interações com outros assistidos e profissionais.', 'positivo', true, 40),
    ('agressividade', 'Comportamentos agressivos observados', 'Intensidade/frequência de comportamentos agressivos observados no período. Descreve observações, não a pessoa.', 'monitoramento', true, 50),
    ('busca_alimentar', 'Comportamentos alimentares de busca persistente', 'Intensidade/frequência de busca persistente por alimentos ou compulsão alimentar observada no período.', 'monitoramento', true, 60),
    ('higiene', 'Higiene e participação nos cuidados', 'Grau de participação e autonomia nos cuidados de higiene, conforme definição institucional.', 'autonomia', true, 70)
  RETURNING id, chave, tipo
)
INSERT INTO indicador_escala_versoes (indicador_id, versao, minimo, maximo, direcao, niveis)
SELECT id, 1, 0, 5,
  CASE tipo WHEN 'positivo' THEN 'maior_melhor'::direcao_interpretacao
            WHEN 'monitoramento' THEN 'menor_melhor'::direcao_interpretacao
            ELSE 'maior_melhor'::direcao_interpretacao END,
  CASE tipo
    WHEN 'positivo' THEN '[
      {"valor":0,"descricao":"Não observado ou ausência da habilidade na situação registrada"},
      {"valor":1,"descricao":"Muito reduzido"},
      {"valor":2,"descricao":"Baixo"},
      {"valor":3,"descricao":"Moderado"},
      {"valor":4,"descricao":"Bom"},
      {"valor":5,"descricao":"Muito bom"}]'::jsonb
    WHEN 'monitoramento' THEN '[
      {"valor":0,"descricao":"Não observado no período avaliado"},
      {"valor":1,"descricao":"Muito baixo"},
      {"valor":2,"descricao":"Baixo"},
      {"valor":3,"descricao":"Moderado"},
      {"valor":4,"descricao":"Elevado"},
      {"valor":5,"descricao":"Muito elevado"}]'::jsonb
    ELSE '[
      {"valor":0,"descricao":"Não participou dos cuidados (apoio integral)"},
      {"valor":1,"descricao":"Participação mínima, com apoio físico constante"},
      {"valor":2,"descricao":"Participação parcial, com apoio físico frequente"},
      {"valor":3,"descricao":"Participa com apoio verbal ou gestual frequente"},
      {"valor":4,"descricao":"Participa com supervisão ou apoio pontual"},
      {"valor":5,"descricao":"Realiza com autonomia na situação observada"}]'::jsonb
  END
FROM ind;

-- Catálogo inicial PARCIAL da CID-10 (códigos frequentes no contexto do centro).
-- Para produção, importe a tabela oficial completa (DATASUS) em Configurações > CID.
INSERT INTO cid_codigos (codigo, descricao) VALUES
  ('F70', 'Retardo mental leve'),
  ('F71', 'Retardo mental moderado'),
  ('F72', 'Retardo mental grave'),
  ('F73', 'Retardo mental profundo'),
  ('F78', 'Outro retardo mental'),
  ('F79', 'Retardo mental não especificado'),
  ('F80.0', 'Transtorno específico da articulação da fala'),
  ('F80.1', 'Transtorno expressivo de linguagem'),
  ('F80.2', 'Transtorno receptivo da linguagem'),
  ('F80.9', 'Transtorno não especificado do desenvolvimento da fala ou da linguagem'),
  ('F81.9', 'Transtorno não especificado do desenvolvimento das habilidades escolares'),
  ('F82', 'Transtorno específico do desenvolvimento motor'),
  ('F83', 'Transtornos específicos misto do desenvolvimento'),
  ('F84.0', 'Autismo infantil'),
  ('F84.1', 'Autismo atípico'),
  ('F84.2', 'Síndrome de Rett'),
  ('F84.3', 'Outro transtorno desintegrativo da infância'),
  ('F84.4', 'Transtorno com hipercinesia associada a retardo mental e a movimentos estereotipados'),
  ('F84.5', 'Síndrome de Asperger'),
  ('F84.8', 'Outros transtornos globais do desenvolvimento'),
  ('F84.9', 'Transtornos globais não especificados do desenvolvimento'),
  ('F88', 'Outros transtornos do desenvolvimento psicológico'),
  ('F89', 'Transtorno do desenvolvimento psicológico não especificado'),
  ('F90.0', 'Distúrbios da atividade e da atenção'),
  ('F90.9', 'Transtorno hipercinético não especificado'),
  ('F20.9', 'Esquizofrenia não especificada'),
  ('F31.9', 'Transtorno afetivo bipolar não especificado'),
  ('F32.9', 'Episódio depressivo não especificado'),
  ('F41.9', 'Transtorno ansioso não especificado'),
  ('F42.9', 'Transtorno obsessivo-compulsivo não especificado'),
  ('F91.9', 'Distúrbio de conduta não especificado'),
  ('F95.2', 'Tiques vocais e motores múltiplos combinados [doença de Gilles de la Tourette]'),
  ('G40.0', 'Epilepsia e síndromes epilépticas idiopáticas definidas por sua localização (focal) (parcial) com crises de início focal'),
  ('G40.1', 'Epilepsia e síndromes epilépticas sintomáticas definidas por sua localização (focal) (parcial) com crises parciais simples'),
  ('G40.2', 'Epilepsia e síndromes epilépticas sintomáticas definidas por sua localização (focal) (parcial) com crises parciais complexas'),
  ('G40.3', 'Epilepsia e síndromes epilépticas generalizadas idiopáticas'),
  ('G40.4', 'Outras epilepsias e síndromes epilépticas generalizadas'),
  ('G40.5', 'Síndromes epilépticas especiais'),
  ('G40.6', 'Crise de grande mal, não especificada (com ou sem pequeno mal)'),
  ('G40.7', 'Pequeno mal não especificado, sem crises de grande mal'),
  ('G40.8', 'Outras epilepsias'),
  ('G40.9', 'Epilepsia, não especificada'),
  ('G41.9', 'Estado de mal epiléptico não especificado'),
  ('G80.0', 'Paralisia cerebral quadriplégica espástica'),
  ('G80.9', 'Paralisia cerebral não especificada'),
  ('Q90.9', 'Síndrome de Down não especificada'),
  ('Q99.2', 'Cromossomo X frágil');
