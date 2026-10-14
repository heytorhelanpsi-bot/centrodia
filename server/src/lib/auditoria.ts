import type { Request } from 'express';
import type { Db } from '../db/pool.js';

export async function auditar(
  db: Db, req: Request | null, acao: string, entidade?: string | null, entidadeId?: string | null,
  detalhes: Record<string, unknown> = {}, usuarioId?: string | null,
) {
  await db.query(
    `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [usuarioId ?? req?.usuario?.id ?? null, acao, entidade ?? null, entidadeId ?? null, detalhes, req?.ip ?? null],
  );
}
