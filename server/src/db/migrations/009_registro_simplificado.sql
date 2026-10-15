-- Cadastro simplificado (nome, idade, CID e anamnese) e rotina por turno e dia.

-- A data de nascimento passa a ser opcional: basta informar a idade.
ALTER TABLE assistidos ALTER COLUMN data_nascimento DROP NOT NULL;
ALTER TABLE assistidos ADD COLUMN idade_informada int CHECK (idade_informada BETWEEN 0 AND 120);
ALTER TABLE assistidos ADD COLUMN idade_informada_em date;
ALTER TABLE assistidos ADD COLUMN anamnese text;
ALTER TABLE assistidos ADD CONSTRAINT assistidos_idade_chk
  CHECK (data_nascimento IS NOT NULL OR (idade_informada IS NOT NULL AND idade_informada_em IS NOT NULL));

-- Dias de funcionamento usados na tela inicial (1 = segunda … 6 = sábado).
INSERT INTO configuracoes (chave, valor) VALUES ('rotina', '{"dias": [1, 3, 5]}')
ON CONFLICT (chave) DO NOTHING;

-- Quem registra pode acrescentar novos comportamentos/parâmetros durante o registro.
INSERT INTO permissoes_perfil (perfil, permissao) VALUES
  ('admin', 'indicadores.criar'), ('profissional', 'indicadores.criar'),
  -- O CID é obrigatório no cadastro; quem cadastra pode incluir no catálogo um código que falte.
  ('profissional', 'cid.inserir_manual')
ON CONFLICT DO NOTHING;
