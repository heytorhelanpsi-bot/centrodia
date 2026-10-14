-- Funções administrativas executadas com privilégios do proprietário, sempre
-- verificando o perfil do usuário em contexto.

-- Permite remover dados marcados como exemplo (demonstração) com segurança.
CREATE OR REPLACE FUNCTION trg_evolucoes_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.exemplo AND current_setting('app.removendo_exemplos', true) = 'on' THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION trg_filhos_evolucao_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  eid uuid;
  st status_registro;
BEGIN
  IF current_setting('app.removendo_exemplos', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.evolucao_id ELSE NEW.evolucao_id END;
  SELECT status INTO st FROM evolucoes WHERE id = eid;
  IF st = 'finalizada' AND NOT correcao_em_andamento(eid) THEN
    RAISE EXCEPTION 'Evolução finalizada: alterações exigem correção registrada com motivo' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_somente_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'relatorio_versoes'
     AND current_setting('app.removendo_exemplos', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Registro imutável (%)', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION trg_correcoes_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.removendo_exemplos', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' OR OLD.txid <> txid_current() OR OLD.dados_novos IS NOT NULL
     OR NEW.dados_anteriores <> OLD.dados_anteriores OR NEW.motivo <> OLD.motivo THEN
    RAISE EXCEPTION 'Histórico de correções é imutável' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION remover_dados_exemplo() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_assist int; n_evol int; n_col int;
BEGIN
  IF app_perfil() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Somente administradores podem remover dados de exemplo' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.removendo_exemplos', 'on', true);

  CREATE TEMP TABLE _ex_assist ON COMMIT DROP AS SELECT id FROM assistidos WHERE exemplo;
  CREATE TEMP TABLE _ex_evol ON COMMIT DROP AS
    SELECT id FROM evolucoes WHERE exemplo OR assistido_id IN (SELECT id FROM _ex_assist);
  CREATE TEMP TABLE _ex_col ON COMMIT DROP AS SELECT id FROM atividades_coletivas WHERE exemplo;
  CREATE TEMP TABLE _ex_rel ON COMMIT DROP AS
    SELECT id FROM relatorios WHERE assistido_id IN (SELECT id FROM _ex_assist)
      OR atividade_coletiva_id IN (SELECT id FROM _ex_col);

  UPDATE relatorios SET versao_aprovada_id = NULL, status = 'arquivado' WHERE id IN (SELECT id FROM _ex_rel) AND status <> 'aprovado';
  ALTER TABLE relatorios DISABLE TRIGGER relatorio_aprovado;
  UPDATE relatorios SET versao_aprovada_id = NULL WHERE id IN (SELECT id FROM _ex_rel);
  ALTER TABLE relatorios ENABLE TRIGGER relatorio_aprovado;
  DELETE FROM relatorio_versoes WHERE relatorio_id IN (SELECT id FROM _ex_rel);
  DELETE FROM relatorios WHERE relatorio_pai_id IN (SELECT id FROM _ex_rel);
  DELETE FROM relatorios WHERE id IN (SELECT id FROM _ex_rel);
  DELETE FROM analises_ia WHERE assistido_id IN (SELECT id FROM _ex_assist) OR evolucao_id IN (SELECT id FROM _ex_evol);
  DELETE FROM evolucao_correcoes WHERE evolucao_id IN (SELECT id FROM _ex_evol);
  DELETE FROM avaliacoes_indicadores WHERE evolucao_id IN (SELECT id FROM _ex_evol);
  DELETE FROM evolucao_atividades WHERE evolucao_id IN (SELECT id FROM _ex_evol);
  DELETE FROM evolucoes WHERE id IN (SELECT id FROM _ex_evol);
  GET DIAGNOSTICS n_evol = ROW_COUNT;
  DELETE FROM coletiva_participantes WHERE atividade_coletiva_id IN (SELECT id FROM _ex_col)
    OR assistido_id IN (SELECT id FROM _ex_assist);
  DELETE FROM atividades_coletivas WHERE id IN (SELECT id FROM _ex_col)
    AND NOT EXISTS (SELECT 1 FROM evolucoes e WHERE e.atividade_coletiva_id = atividades_coletivas.id);
  GET DIAGNOSTICS n_col = ROW_COUNT;
  DELETE FROM assistido_diagnosticos WHERE assistido_id IN (SELECT id FROM _ex_assist);
  DELETE FROM assistido_agenda WHERE assistido_id IN (SELECT id FROM _ex_assist);
  DELETE FROM usuario_assistido WHERE assistido_id IN (SELECT id FROM _ex_assist);
  DELETE FROM assistidos WHERE id IN (SELECT id FROM _ex_assist);
  GET DIAGNOSTICS n_assist = ROW_COUNT;
  RETURN jsonb_build_object('assistidos', n_assist, 'evolucoes', n_evol, 'atividades_coletivas', n_col);
END $$;
REVOKE ALL ON FUNCTION remover_dados_exemplo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remover_dados_exemplo() TO {{APP_ROLE}};
