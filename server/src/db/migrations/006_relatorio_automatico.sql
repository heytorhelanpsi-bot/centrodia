-- Versões de relatório compiladas automaticamente pelo sistema (sem IA).
ALTER TABLE relatorio_versoes DROP CONSTRAINT relatorio_versoes_origem_check;
ALTER TABLE relatorio_versoes ADD CONSTRAINT relatorio_versoes_origem_check CHECK (origem IN ('ia', 'profissional', 'sistema'));
