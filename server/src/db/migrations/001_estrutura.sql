-- Reabilita+ — estrutura inicial do banco de dados
-- Executada pelo papel proprietário (dono das tabelas). A aplicação conecta com
-- um papel separado (APP_DB_ROLE) sujeito às políticas de RLS definidas abaixo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
CREATE TYPE perfil_usuario AS ENUM ('admin', 'profissional', 'consulta');
CREATE TYPE turno AS ENUM ('manha', 'tarde');
CREATE TYPE turno_habitual AS ENUM ('manha', 'tarde', 'ambos');
CREATE TYPE status_assistido AS ENUM ('ativo', 'arquivado');
CREATE TYPE status_registro AS ENUM ('rascunho', 'finalizada');
CREATE TYPE tipo_atendimento AS ENUM ('individual', 'participacao_coletiva');
CREATE TYPE grau_realizacao AS ENUM ('integral', 'parcial', 'nao_realizada');
CREATE TYPE tipo_indicador AS ENUM ('positivo', 'monitoramento', 'autonomia', 'outro');
CREATE TYPE direcao_interpretacao AS ENUM ('maior_melhor', 'menor_melhor', 'neutra');

-- ---------------------------------------------------------------------------
-- Usuários, perfis e sessões
-- ---------------------------------------------------------------------------
CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(trim(nome)) > 1),
  email text NOT NULL,
  senha_hash text NOT NULL,
  perfil perfil_usuario NOT NULL DEFAULT 'consulta',
  funcao text,                                   -- função na equipe multidisciplinar (informativo)
  ativo boolean NOT NULL DEFAULT true,
  acesso_todos_assistidos boolean NOT NULL DEFAULT false,
  deve_trocar_senha boolean NOT NULL DEFAULT true,
  tentativas_falhas int NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  ultimo_login timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_email_unq ON usuarios (lower(email));

CREATE TABLE permissoes_perfil (
  perfil perfil_usuario NOT NULL,
  permissao text NOT NULL,
  PRIMARY KEY (perfil, permissao)
);

CREATE TABLE sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  token_hash text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  revogada_em timestamptz,
  ip text,
  user_agent text
);
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);

CREATE TABLE tokens_recuperacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  token_hash text NOT NULL UNIQUE,
  emitido_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);

CREATE TABLE configuracoes (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES usuarios(id)
);

-- ---------------------------------------------------------------------------
-- Funções de contexto (preenchidas pela aplicação a cada transação)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_usuario_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

-- SECURITY DEFINER: lê o perfil diretamente da tabela de usuários, de modo que o
-- perfil efetivo nunca dependa de um valor informado pela aplicação.
CREATE FUNCTION app_perfil() RETURNS perfil_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT perfil FROM usuarios WHERE id = app_usuario_id() AND ativo
$$;

CREATE FUNCTION app_pode_editar() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_perfil() IN ('admin', 'profissional'), false)
$$;

-- ---------------------------------------------------------------------------
-- Assistidos
-- ---------------------------------------------------------------------------
CREATE SEQUENCE assistidos_codigo_seq START 1;

CREATE TABLE assistidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE DEFAULT ('RB-' || lpad(nextval('assistidos_codigo_seq')::text, 5, '0')),
  nome_completo text NOT NULL CHECK (length(trim(nome_completo)) > 2),
  nome_busca text NOT NULL,                    -- nome normalizado (sem acentos, minúsculo)
  data_nascimento date NOT NULL CHECK (data_nascimento > date '1900-01-01'),
  turno_habitual turno_habitual NOT NULL,
  observacoes_restritas_cifradas text,         -- AES-256-GCM, cifrado pela aplicação
  status status_assistido NOT NULL DEFAULT 'ativo',
  exemplo boolean NOT NULL DEFAULT false,      -- registro de demonstração
  anonimizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid NOT NULL REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES usuarios(id),
  arquivado_em timestamptz,
  arquivado_por uuid REFERENCES usuarios(id)
);
-- Impede duplicidade acidental: mesmo nome normalizado + mesma data de nascimento.
CREATE UNIQUE INDEX assistidos_duplicidade_unq ON assistidos (nome_busca, data_nascimento)
  WHERE anonimizado_em IS NULL;
CREATE INDEX assistidos_nome_busca_idx ON assistidos (nome_busca);

-- Atribuição de assistidos a usuários (acesso mínimo necessário).
CREATE TABLE usuario_assistido (
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  atribuido_por uuid REFERENCES usuarios(id),
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, assistido_id)
);

CREATE FUNCTION pode_ver_assistido(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = app_usuario_id() AND u.ativo AND (
      u.perfil = 'admin'
      OR u.acesso_todos_assistidos
      OR EXISTS (SELECT 1 FROM usuario_assistido ua WHERE ua.usuario_id = u.id AND ua.assistido_id = aid)
      OR EXISTS (SELECT 1 FROM assistidos a WHERE a.id = aid AND a.criado_por = u.id)
    )
  )
$$;

CREATE TABLE assistido_agenda (
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 6), -- 1=segunda … 6=sábado
  PRIMARY KEY (assistido_id, dia_semana)
);

CREATE TABLE cid_codigos (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$'),
  descricao text NOT NULL,
  origem text NOT NULL DEFAULT 'catalogo',   -- 'catalogo' | 'importacao' | 'manual'
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistido_diagnosticos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  descricao text NOT NULL,
  cid_codigo text REFERENCES cid_codigos(codigo),
  -- Situação documental: o sistema não presume que um código informado seja diagnóstico confirmado.
  situacao text NOT NULL DEFAULT 'pendente_documentacao'
    CHECK (situacao IN ('documentado_prontuario', 'pendente_documentacao')),
  fonte_documental text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid NOT NULL REFERENCES usuarios(id)
);
CREATE INDEX assistido_diagnosticos_assistido_idx ON assistido_diagnosticos (assistido_id);

-- ---------------------------------------------------------------------------
-- Atividades e indicadores (configuração)
-- ---------------------------------------------------------------------------
CREATE TABLE atividades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text NOT NULL DEFAULT 'Geral',
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  padrao boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX atividades_nome_unq ON atividades (lower(nome));

CREATE TABLE indicadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  tipo tipo_indicador NOT NULL,
  observacao_obrigatoria boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  padrao boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 100,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Versões imutáveis da escala. Cada avaliação referencia a versão vigente no momento do registro.
CREATE TABLE indicador_escala_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id uuid NOT NULL REFERENCES indicadores(id),
  versao int NOT NULL,
  minimo int NOT NULL,
  maximo int NOT NULL,
  direcao direcao_interpretacao NOT NULL,
  niveis jsonb NOT NULL,          -- [{ "valor": 0, "descricao": "…" }, …]
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuarios(id),
  UNIQUE (indicador_id, versao),
  CHECK (minimo < maximo AND minimo >= 0 AND maximo <= 10)
);

CREATE VIEW indicadores_vigentes AS
SELECT i.*, v.id AS escala_versao_id, v.versao, v.minimo, v.maximo, v.direcao, v.niveis
FROM indicadores i
JOIN LATERAL (
  SELECT * FROM indicador_escala_versoes v WHERE v.indicador_id = i.id ORDER BY versao DESC LIMIT 1
) v ON true;

CREATE TABLE atividade_indicadores (
  atividade_id uuid NOT NULL REFERENCES atividades(id),
  indicador_id uuid NOT NULL REFERENCES indicadores(id),
  PRIMARY KEY (atividade_id, indicador_id)
);

-- ---------------------------------------------------------------------------
-- Atividades coletivas
-- ---------------------------------------------------------------------------
CREATE TABLE atividades_coletivas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  horario text,
  turno turno NOT NULL,
  profissional_id uuid NOT NULL REFERENCES usuarios(id),
  atividade_id uuid REFERENCES atividades(id),
  nome_atividade text NOT NULL,
  local text,
  objetivo text,
  descricao_proposta text,
  observacoes_gerais text,
  status status_registro NOT NULL DEFAULT 'rascunho',
  exemplo boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz
);

-- ---------------------------------------------------------------------------
-- Evoluções (atendimentos individuais e participações individuais em grupo)
-- ---------------------------------------------------------------------------
CREATE TABLE evolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  profissional_id uuid NOT NULL REFERENCES usuarios(id),
  atividade_coletiva_id uuid REFERENCES atividades_coletivas(id),
  data date NOT NULL,
  horario text,
  turno turno NOT NULL,
  tipo tipo_atendimento NOT NULL DEFAULT 'individual',
  duracao_minutos int CHECK (duracao_minutos IS NULL OR duracao_minutos BETWEEN 1 AND 720),
  local text,
  participacao grau_realizacao,                -- usado em participações coletivas
  nivel_apoio text CHECK (nivel_apoio IS NULL OR nivel_apoio IN
    ('sem_apoio', 'apoio_pontual', 'apoio_frequente', 'apoio_intenso', 'apoio_integral')),
  texto_evolucao text,
  comportamentos text,
  interacao text,
  resposta_orientacoes text,
  apoios_estrategias text,
  ocorrencias text,
  observacoes_complementares text,
  status status_registro NOT NULL DEFAULT 'rascunho',
  versao int NOT NULL DEFAULT 1,
  exemplo boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  CHECK (status = 'rascunho' OR finalizada_em IS NOT NULL),
  CHECK (tipo = 'individual' OR atividade_coletiva_id IS NOT NULL OR participacao IS NOT NULL)
);
CREATE INDEX evolucoes_assistido_data_idx ON evolucoes (assistido_id, data DESC);
CREATE INDEX evolucoes_data_idx ON evolucoes (data);
CREATE UNIQUE INDEX evolucoes_coletiva_assistido_unq ON evolucoes (atividade_coletiva_id, assistido_id)
  WHERE atividade_coletiva_id IS NOT NULL;

CREATE TABLE evolucao_atividades (
  evolucao_id uuid NOT NULL REFERENCES evolucoes(id),
  atividade_id uuid NOT NULL REFERENCES atividades(id),
  realizacao grau_realizacao,
  PRIMARY KEY (evolucao_id, atividade_id)
);

CREATE TABLE avaliacoes_indicadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evolucao_id uuid NOT NULL REFERENCES evolucoes(id),
  indicador_id uuid NOT NULL REFERENCES indicadores(id),
  escala_versao_id uuid NOT NULL REFERENCES indicador_escala_versoes(id),
  valor int,                                   -- NULL = "Não avaliado" (nunca tratado como zero)
  observacao text,
  UNIQUE (evolucao_id, indicador_id)
);

CREATE TABLE coletiva_participantes (
  atividade_coletiva_id uuid NOT NULL REFERENCES atividades_coletivas(id),
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  situacao text NOT NULL CHECK (situacao IN ('participante', 'previsto_ausente')),
  motivo_ausencia text,
  PRIMARY KEY (atividade_coletiva_id, assistido_id)
);

-- Histórico de correções de registros finalizados.
CREATE TABLE evolucao_correcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evolucao_id uuid NOT NULL REFERENCES evolucoes(id),
  alterado_por uuid NOT NULL REFERENCES usuarios(id),
  alterado_em timestamptz NOT NULL DEFAULT now(),
  motivo text NOT NULL CHECK (length(trim(motivo)) >= 5),
  dados_anteriores jsonb NOT NULL,
  dados_novos jsonb,
  txid bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX evolucao_correcoes_evolucao_idx ON evolucao_correcoes (evolucao_id);

-- ---------------------------------------------------------------------------
-- IA e relatórios
-- ---------------------------------------------------------------------------
CREATE TABLE analises_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('evolucao', 'longitudinal')),
  assistido_id uuid NOT NULL REFERENCES assistidos(id),
  evolucao_id uuid REFERENCES evolucoes(id),
  periodo_inicio date,
  periodo_fim date,
  registros_ids uuid[] NOT NULL DEFAULT '{}',
  modelo text NOT NULL,
  versao_prompt text NOT NULL,
  conteudo_ia jsonb NOT NULL,
  texto_revisado text,
  status text NOT NULL DEFAULT 'minuta' CHECK (status IN ('minuta', 'revisada', 'descartada')),
  gerado_por uuid NOT NULL REFERENCES usuarios(id),
  gerado_em timestamptz NOT NULL DEFAULT now(),
  revisado_por uuid REFERENCES usuarios(id),
  revisado_em timestamptz
);
CREATE INDEX analises_ia_assistido_idx ON analises_ia (assistido_id, gerado_em DESC);

CREATE TABLE relatorios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN (
    'individual_evolucao', 'mensal', 'trimestral', 'semestral', 'participacao_atividades',
    'indicadores_comportamentais', 'atividade_grupo', 'discussao_multidisciplinar')),
  assistido_id uuid REFERENCES assistidos(id),
  atividade_coletiva_id uuid REFERENCES atividades_coletivas(id),
  relatorio_pai_id uuid REFERENCES relatorios(id),   -- anexos individuais de relatórios de grupo
  titulo text NOT NULL,
  objetivo text,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  registros_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'minuta' CHECK (status IN ('minuta', 'aprovado', 'arquivado')),
  versao_aprovada_id uuid,
  criado_por uuid NOT NULL REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_por uuid REFERENCES usuarios(id),
  aprovado_em timestamptz,
  CHECK (periodo_inicio <= periodo_fim),
  CHECK (assistido_id IS NOT NULL OR atividade_coletiva_id IS NOT NULL)
);

CREATE TABLE relatorio_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relatorio_id uuid NOT NULL REFERENCES relatorios(id),
  numero int NOT NULL,
  origem text NOT NULL CHECK (origem IN ('ia', 'profissional')),
  conteudo text NOT NULL,
  modelo text,
  versao_prompt text,
  instrucoes text,
  autor_id uuid NOT NULL REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (relatorio_id, numero)
);
ALTER TABLE relatorios ADD CONSTRAINT relatorios_versao_aprovada_fk
  FOREIGN KEY (versao_aprovada_id) REFERENCES relatorio_versoes(id);

-- ---------------------------------------------------------------------------
-- Auditoria (somente inserção para a aplicação)
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES usuarios(id),
  acao text NOT NULL,
  entidade text,
  entidade_id text,
  detalhes jsonb NOT NULL DEFAULT '{}',
  ip text
);
CREATE INDEX auditoria_ocorrido_idx ON auditoria (ocorrido_em DESC);
CREATE INDEX auditoria_entidade_idx ON auditoria (entidade, entidade_id);

-- ---------------------------------------------------------------------------
-- Regras de integridade (gatilhos)
-- ---------------------------------------------------------------------------

-- Verifica se a transação atual registrou uma correção para a evolução.
CREATE FUNCTION correcao_em_andamento(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM evolucao_correcoes c
    WHERE c.evolucao_id = eid AND c.txid = txid_current() AND c.alterado_por = app_usuario_id()
  )
$$;

CREATE FUNCTION trg_evolucoes_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Evoluções não podem ser apagadas' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'finalizada' THEN
    IF NEW.status <> 'finalizada' THEN
      RAISE EXCEPTION 'Uma evolução finalizada não pode voltar a rascunho' USING ERRCODE = 'P0001';
    END IF;
    IF NOT correcao_em_andamento(OLD.id) THEN
      RAISE EXCEPTION 'Evolução finalizada: alterações exigem correção registrada com motivo' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.assistido_id <> OLD.assistido_id OR NEW.profissional_id <> OLD.profissional_id
       OR NEW.criado_em <> OLD.criado_em OR NEW.finalizada_em <> OLD.finalizada_em THEN
      RAISE EXCEPTION 'Campos de identificação do registro não podem ser alterados' USING ERRCODE = 'P0001';
    END IF;
    NEW.versao := OLD.versao + 1;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
CREATE TRIGGER evolucoes_imutavel BEFORE UPDATE OR DELETE ON evolucoes
  FOR EACH ROW EXECUTE FUNCTION trg_evolucoes_imutavel();

CREATE FUNCTION trg_filhos_evolucao_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  eid uuid;
  st status_registro;
BEGIN
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.evolucao_id ELSE NEW.evolucao_id END;
  SELECT status INTO st FROM evolucoes WHERE id = eid;
  IF st = 'finalizada' AND NOT correcao_em_andamento(eid) THEN
    RAISE EXCEPTION 'Evolução finalizada: alterações exigem correção registrada com motivo' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER avaliacoes_imutavel BEFORE INSERT OR UPDATE OR DELETE ON avaliacoes_indicadores
  FOR EACH ROW EXECUTE FUNCTION trg_filhos_evolucao_imutavel();
CREATE TRIGGER evolucao_atividades_imutavel BEFORE INSERT OR UPDATE OR DELETE ON evolucao_atividades
  FOR EACH ROW EXECUTE FUNCTION trg_filhos_evolucao_imutavel();

-- A pontuação deve respeitar a escala da versão referenciada e a versão deve pertencer ao indicador.
CREATE FUNCTION trg_valida_avaliacao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v indicador_escala_versoes;
BEGIN
  SELECT * INTO v FROM indicador_escala_versoes WHERE id = NEW.escala_versao_id;
  IF v.indicador_id <> NEW.indicador_id THEN
    RAISE EXCEPTION 'Versão de escala não pertence ao indicador' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.valor IS NOT NULL AND (NEW.valor < v.minimo OR NEW.valor > v.maximo) THEN
    RAISE EXCEPTION 'Pontuação % fora da escala (% a %)', NEW.valor, v.minimo, v.maximo USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER avaliacoes_valida BEFORE INSERT OR UPDATE ON avaliacoes_indicadores
  FOR EACH ROW EXECUTE FUNCTION trg_valida_avaliacao();

-- Versões de escala e auditoria são imutáveis.
CREATE FUNCTION trg_somente_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável (%)', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER escala_versoes_imutavel BEFORE UPDATE OR DELETE ON indicador_escala_versoes
  FOR EACH ROW EXECUTE FUNCTION trg_somente_insercao();
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION trg_somente_insercao();

-- Correções: só é possível completar "dados_novos" na mesma transação; nunca apagar.
CREATE FUNCTION trg_correcoes_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.txid <> txid_current() OR OLD.dados_novos IS NOT NULL
     OR NEW.dados_anteriores <> OLD.dados_anteriores OR NEW.motivo <> OLD.motivo THEN
    RAISE EXCEPTION 'Histórico de correções é imutável' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER correcoes_imutavel BEFORE UPDATE OR DELETE ON evolucao_correcoes
  FOR EACH ROW EXECUTE FUNCTION trg_correcoes_imutavel();

-- Relatório aprovado não volta a ser minuta e suas versões não mudam.
CREATE FUNCTION trg_relatorio_aprovado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'aprovado' AND NEW.status = 'minuta' THEN
    RAISE EXCEPTION 'Relatório aprovado não pode voltar a minuta' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'aprovado' AND NEW.versao_aprovada_id IS DISTINCT FROM OLD.versao_aprovada_id THEN
    RAISE EXCEPTION 'Versão aprovada não pode ser substituída' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relatorio_aprovado BEFORE UPDATE ON relatorios
  FOR EACH ROW EXECUTE FUNCTION trg_relatorio_aprovado();
CREATE TRIGGER relatorio_versoes_imutavel BEFORE UPDATE OR DELETE ON relatorio_versoes
  FOR EACH ROW EXECUTE FUNCTION trg_somente_insercao();

-- ---------------------------------------------------------------------------
-- Segurança em nível de linha (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE assistidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistidos_sel ON assistidos FOR SELECT USING (pode_ver_assistido(id) OR criado_por = app_usuario_id());
CREATE POLICY assistidos_ins ON assistidos FOR INSERT WITH CHECK (app_pode_editar() AND criado_por = app_usuario_id());
CREATE POLICY assistidos_upd ON assistidos FOR UPDATE USING (app_pode_editar() AND pode_ver_assistido(id));

ALTER TABLE usuario_assistido ENABLE ROW LEVEL SECURITY;
CREATE POLICY ua_sel ON usuario_assistido FOR SELECT USING (app_perfil() = 'admin' OR usuario_id = app_usuario_id());
CREATE POLICY ua_ins ON usuario_assistido FOR INSERT WITH CHECK (
  app_perfil() = 'admin' OR (app_pode_editar() AND usuario_id = app_usuario_id() AND pode_ver_assistido(assistido_id)));
CREATE POLICY ua_del ON usuario_assistido FOR DELETE USING (app_perfil() = 'admin');

ALTER TABLE assistido_agenda ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_sel ON assistido_agenda FOR SELECT USING (pode_ver_assistido(assistido_id));
CREATE POLICY agenda_ins ON assistido_agenda FOR INSERT WITH CHECK (app_pode_editar() AND pode_ver_assistido(assistido_id));
CREATE POLICY agenda_del ON assistido_agenda FOR DELETE USING (app_pode_editar() AND pode_ver_assistido(assistido_id));

ALTER TABLE assistido_diagnosticos ENABLE ROW LEVEL SECURITY;
CREATE POLICY diag_sel ON assistido_diagnosticos FOR SELECT USING (pode_ver_assistido(assistido_id));
CREATE POLICY diag_ins ON assistido_diagnosticos FOR INSERT WITH CHECK (app_pode_editar() AND pode_ver_assistido(assistido_id) AND criado_por = app_usuario_id());
CREATE POLICY diag_del ON assistido_diagnosticos FOR DELETE USING (app_pode_editar() AND pode_ver_assistido(assistido_id));

ALTER TABLE evolucoes ENABLE ROW LEVEL SECURITY;
-- Rascunhos são visíveis apenas ao autor e à administração.
CREATE POLICY evol_sel ON evolucoes FOR SELECT USING (
  pode_ver_assistido(assistido_id)
  AND (status = 'finalizada' OR profissional_id = app_usuario_id() OR app_perfil() = 'admin'));
CREATE POLICY evol_ins ON evolucoes FOR INSERT WITH CHECK (
  app_pode_editar() AND profissional_id = app_usuario_id() AND pode_ver_assistido(assistido_id));
CREATE POLICY evol_upd ON evolucoes FOR UPDATE USING (
  app_pode_editar() AND pode_ver_assistido(assistido_id)
  AND (profissional_id = app_usuario_id() OR (status = 'finalizada' AND app_perfil() = 'admin')));

CREATE FUNCTION pode_editar_evolucao(eid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM evolucoes e WHERE e.id = eid AND app_pode_editar()
      AND (e.profissional_id = app_usuario_id() OR (e.status = 'finalizada' AND app_perfil() = 'admin')))
$$;

ALTER TABLE evolucao_atividades ENABLE ROW LEVEL SECURITY;
CREATE POLICY ea_sel ON evolucao_atividades FOR SELECT USING (EXISTS (SELECT 1 FROM evolucoes e WHERE e.id = evolucao_id));
CREATE POLICY ea_ins ON evolucao_atividades FOR INSERT WITH CHECK (pode_editar_evolucao(evolucao_id));
CREATE POLICY ea_upd ON evolucao_atividades FOR UPDATE USING (pode_editar_evolucao(evolucao_id));
CREATE POLICY ea_del ON evolucao_atividades FOR DELETE USING (pode_editar_evolucao(evolucao_id));

ALTER TABLE avaliacoes_indicadores ENABLE ROW LEVEL SECURITY;
CREATE POLICY av_sel ON avaliacoes_indicadores FOR SELECT USING (EXISTS (SELECT 1 FROM evolucoes e WHERE e.id = evolucao_id));
CREATE POLICY av_ins ON avaliacoes_indicadores FOR INSERT WITH CHECK (pode_editar_evolucao(evolucao_id));
CREATE POLICY av_upd ON avaliacoes_indicadores FOR UPDATE USING (pode_editar_evolucao(evolucao_id));
CREATE POLICY av_del ON avaliacoes_indicadores FOR DELETE USING (pode_editar_evolucao(evolucao_id));

ALTER TABLE evolucao_correcoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY corr_sel ON evolucao_correcoes FOR SELECT USING (EXISTS (SELECT 1 FROM evolucoes e WHERE e.id = evolucao_id));
CREATE POLICY corr_ins ON evolucao_correcoes FOR INSERT WITH CHECK (
  alterado_por = app_usuario_id() AND pode_editar_evolucao(evolucao_id));
CREATE POLICY corr_upd ON evolucao_correcoes FOR UPDATE USING (alterado_por = app_usuario_id());

ALTER TABLE atividades_coletivas ENABLE ROW LEVEL SECURITY;
-- A descrição geral do evento é visível à equipe; os participantes são filtrados por assistido.
CREATE POLICY ac_sel ON atividades_coletivas FOR SELECT USING (app_perfil() IS NOT NULL);
CREATE POLICY ac_ins ON atividades_coletivas FOR INSERT WITH CHECK (app_pode_editar() AND profissional_id = app_usuario_id());
CREATE POLICY ac_upd ON atividades_coletivas FOR UPDATE USING (
  app_pode_editar() AND (profissional_id = app_usuario_id() OR app_perfil() = 'admin'));

ALTER TABLE coletiva_participantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_sel ON coletiva_participantes FOR SELECT USING (pode_ver_assistido(assistido_id));
CREATE POLICY cp_ins ON coletiva_participantes FOR INSERT WITH CHECK (
  pode_ver_assistido(assistido_id) AND EXISTS (SELECT 1 FROM atividades_coletivas a WHERE a.id = atividade_coletiva_id
    AND a.status = 'rascunho' AND (a.profissional_id = app_usuario_id() OR app_perfil() = 'admin')));
CREATE POLICY cp_upd ON coletiva_participantes FOR UPDATE USING (
  pode_ver_assistido(assistido_id) AND EXISTS (SELECT 1 FROM atividades_coletivas a WHERE a.id = atividade_coletiva_id
    AND a.status = 'rascunho' AND (a.profissional_id = app_usuario_id() OR app_perfil() = 'admin')));
CREATE POLICY cp_del ON coletiva_participantes FOR DELETE USING (
  EXISTS (SELECT 1 FROM atividades_coletivas a WHERE a.id = atividade_coletiva_id
    AND a.status = 'rascunho' AND (a.profissional_id = app_usuario_id() OR app_perfil() = 'admin')));

ALTER TABLE analises_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY ia_sel ON analises_ia FOR SELECT USING (
  pode_ver_assistido(assistido_id) AND (app_perfil() <> 'consulta' OR status = 'revisada'));
CREATE POLICY ia_ins ON analises_ia FOR INSERT WITH CHECK (
  app_pode_editar() AND gerado_por = app_usuario_id() AND pode_ver_assistido(assistido_id));
CREATE POLICY ia_upd ON analises_ia FOR UPDATE USING (
  app_pode_editar() AND pode_ver_assistido(assistido_id) AND (gerado_por = app_usuario_id() OR app_perfil() = 'admin'));

ALTER TABLE relatorios ENABLE ROW LEVEL SECURITY;
-- Perfil de consulta vê somente relatórios aprovados (liberados).
CREATE POLICY rel_sel ON relatorios FOR SELECT USING (
  (assistido_id IS NULL OR pode_ver_assistido(assistido_id))
  AND app_perfil() IS NOT NULL
  AND (app_perfil() <> 'consulta' OR status = 'aprovado'));
CREATE POLICY rel_ins ON relatorios FOR INSERT WITH CHECK (
  app_pode_editar() AND criado_por = app_usuario_id() AND (assistido_id IS NULL OR pode_ver_assistido(assistido_id)));
CREATE POLICY rel_upd ON relatorios FOR UPDATE USING (
  app_pode_editar() AND (assistido_id IS NULL OR pode_ver_assistido(assistido_id))
  AND (criado_por = app_usuario_id() OR app_perfil() = 'admin'));

ALTER TABLE relatorio_versoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY rv_sel ON relatorio_versoes FOR SELECT USING (EXISTS (SELECT 1 FROM relatorios r WHERE r.id = relatorio_id));
CREATE POLICY rv_ins ON relatorio_versoes FOR INSERT WITH CHECK (
  autor_id = app_usuario_id() AND EXISTS (SELECT 1 FROM relatorios r WHERE r.id = relatorio_id AND r.status = 'minuta'
    AND app_pode_editar() AND (r.criado_por = app_usuario_id() OR app_perfil() = 'admin')));

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY aud_ins ON auditoria FOR INSERT WITH CHECK (usuario_id IS NULL OR usuario_id = app_usuario_id() OR app_usuario_id() IS NULL);
CREATE POLICY aud_sel ON auditoria FOR SELECT USING (app_perfil() = 'admin');
