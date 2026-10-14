-- PsiDia: novo prefixo para os códigos internos de assistidos (os já emitidos são mantidos).
ALTER TABLE assistidos ALTER COLUMN codigo SET DEFAULT ('PD-' || lpad(nextval('assistidos_codigo_seq')::text, 5, '0'));
