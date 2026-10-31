import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { validateDatabase, origin } from './config';
import { requireThat } from '../domain/errors';
const globalDb = globalThis as unknown as { pool?: Pool };
export function pool() {
  if (!globalDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL не задан');
    validateDatabase(connectionString);
    globalDb.pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000,
      options: `-c timezone=UTC -c app.data_origin=${origin()}` });
  }
  return globalDb.pool;
}
export type Db = Pick<PoolClient, 'query'>;
export async function assertDatabaseIdentity(db:Db) {
  const identity=(await db.query('SELECT data_origin FROM database_identity WHERE singleton')).rows[0];
  requireThat(identity?.data_origin===origin(),'DATABASE_MODE_MISMATCH','Происхождение базы не совпадает с режимом приложения',503);
}
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  await assertDatabaseIdentity(pool());
  return (await pool().query<T>(sql, values)).rows;
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query('BEGIN');
    await assertDatabaseIdentity(db);
    await db.query("SET LOCAL lock_timeout = '5s'");
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); }
}
