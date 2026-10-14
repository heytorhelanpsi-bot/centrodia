-- Permite ao autor descartar um rascunho de evolução (nunca uma evolução finalizada).
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

CREATE POLICY evol_del ON evolucoes FOR DELETE USING (status = 'rascunho' AND profissional_id = app_usuario_id());
GRANT DELETE ON evolucoes TO {{APP_ROLE}};
