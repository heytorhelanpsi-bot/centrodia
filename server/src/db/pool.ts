import pg from 'pg';
import { config } from '../config.js';

// Datas (tipo DATE) retornam como texto 'AAAA-MM-DD' para evitar deslocamentos de fuso.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolMax });

export type Db = pg.PoolClient;

export interface Contexto {
  usuarioId: string | null;
}

/**
 * Executa uma função dentro de uma transação com o contexto do usuário definido
 * (app.usuario_id). As políticas de RLS do banco usam esse contexto.
 */
export async function withTx<T>(ctx: Contexto, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [ctx.usuarioId ?? '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
