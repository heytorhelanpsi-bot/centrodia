-- Exclusão de registros lançados por engano. O registro não é apagado: fica marcado como
-- excluído (com motivo, responsável e data), some das listas e relatórios e permanece na auditoria.
ALTER TYPE status_registro ADD VALUE IF NOT EXISTS 'excluida';
ALTER TABLE evolucoes ADD COLUMN excluida_em timestamptz;
ALTER TABLE evolucoes ADD COLUMN excluida_por uuid REFERENCES usuarios(id);
ALTER TABLE evolucoes ADD COLUMN motivo_exclusao text;

CREATE OR REPLACE FUNCTION trg_evolucoes_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.exemplo AND current_setting('app.removendo_exemplos', true) = 'on' THEN
      RETURN OLD;
    END IF;
    IF OLD.status = 'rascunho' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Evoluções finalizadas não podem ser apagadas' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status::text = 'excluida' THEN
    RAISE EXCEPTION 'Registro excluído não pode ser alterado' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'finalizada' THEN
    IF NOT correcao_em_andamento(OLD.id) THEN
      RAISE EXCEPTION 'Evolução finalizada: alterações exigem correção registrada com motivo' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status::text = 'excluida' THEN
      IF NEW.excluida_em IS NULL OR NEW.excluida_por IS NULL OR coalesce(length(trim(NEW.motivo_exclusao)), 0) < 5 THEN
        RAISE EXCEPTION 'A exclusão exige motivo, responsável e data' USING ERRCODE = 'P0001';
      END IF;
    ELSIF NEW.status <> 'finalizada' THEN
      RAISE EXCEPTION 'Uma evolução finalizada não pode voltar a rascunho' USING ERRCODE = 'P0001';
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
  st text;
BEGIN
  IF current_setting('app.removendo_exemplos', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.evolucao_id ELSE NEW.evolucao_id END;
  SELECT status::text INTO st FROM evolucoes WHERE id = eid;
  IF st = 'excluida' THEN
    RAISE EXCEPTION 'Registro excluído não pode ser alterado' USING ERRCODE = 'P0001';
  END IF;
  IF st = 'finalizada' AND NOT correcao_em_andamento(eid) THEN
    RAISE EXCEPTION 'Evolução finalizada: alterações exigem correção registrada com motivo' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- A administração pode excluir registros finalizados de outros profissionais (a nova linha fica "excluída").
DROP POLICY evol_upd ON evolucoes;
CREATE POLICY evol_upd ON evolucoes FOR UPDATE USING (
  app_pode_editar() AND pode_ver_assistido(assistido_id)
  AND (profissional_id = app_usuario_id() OR (status = 'finalizada' AND app_perfil() = 'admin')))
  WITH CHECK (
  app_pode_editar() AND pode_ver_assistido(assistido_id)
  AND (profissional_id = app_usuario_id() OR (status <> 'rascunho' AND app_perfil() = 'admin')));
