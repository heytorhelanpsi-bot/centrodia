-- Segredos gerados pelo sistema (ex.: chave de cifragem quando não definida por variável de ambiente).
-- Acessível somente ao papel proprietário: o papel da aplicação não recebe nenhum privilégio.
CREATE TABLE segredos_sistema (
  chave text PRIMARY KEY,
  valor text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON segredos_sistema FROM PUBLIC;
