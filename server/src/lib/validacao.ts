import { z } from 'zod';
import { HttpError } from './util.js';

export function validar<T extends z.ZodType>(schema: T, dados: unknown): z.infer<T> {
  const r = schema.safeParse(dados);
  if (!r.success) {
    const campos = r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
    throw new HttpError(400, 'Dados inválidos. Verifique os campos destacados.', campos);
  }
  return r.data;
}

export const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida');
export const uuid = z.string().uuid('Identificador inválido');
export const textoOpc = z.string().trim().max(20000).nullish().transform((v) => (v ? v : null));
export const turno = z.enum(['manha', 'tarde']);
