-- Privilégios do papel da aplicação, reaplicados a cada execução das migrações (idempotente).
-- Garante permissões corretas mesmo se APP_DB_ROLE mudar depois da instalação.
-- Mantenha em sincronia com as migrações que criarem novas tabelas.
GRANT USAGE ON SCHEMA public TO {{APP_ROLE}};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON usuarios, sessoes, tokens_recuperacao, configuracoes TO {{APP_ROLE}};
GRANT SELECT, INSERT, DELETE ON permissoes_perfil TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON assistidos TO {{APP_ROLE}};
GRANT SELECT, INSERT, DELETE ON usuario_assistido, assistido_agenda, assistido_diagnosticos TO {{APP_ROLE}};
GRANT SELECT, INSERT ON cid_codigos TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON atividades, indicadores TO {{APP_ROLE}};
GRANT SELECT, INSERT, DELETE ON atividade_indicadores TO {{APP_ROLE}};
GRANT SELECT, INSERT ON indicador_escala_versoes TO {{APP_ROLE}};
GRANT SELECT ON indicadores_vigentes TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON atividades_coletivas TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE, DELETE ON evolucoes TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE, DELETE ON evolucao_atividades, avaliacoes_indicadores, coletiva_participantes TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON evolucao_correcoes TO {{APP_ROLE}};
GRANT SELECT, INSERT, UPDATE ON analises_ia, relatorios TO {{APP_ROLE}};
GRANT SELECT, INSERT ON relatorio_versoes TO {{APP_ROLE}};
GRANT SELECT, INSERT ON auditoria TO {{APP_ROLE}};
GRANT EXECUTE ON FUNCTION remover_dados_exemplo() TO {{APP_ROLE}};
