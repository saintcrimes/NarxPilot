import { createHash } from 'node:crypto';
import { requireThat } from '../domain/errors';
import type { Actor } from '../domain/types';
import type { Db } from './db';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value !== null && typeof value === 'object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export async function idempotent<T>(db: Db, actor: Actor, operation: string, key: string, body: unknown, run:()=>Promise<T>): Promise<T> {
  requireThat(/^[a-zA-Z0-9_-]{8,100}$/.test(key),'IDEMPOTENCY_KEY_REQUIRED','Нужен ключ операции (8–100 символов)',400);
  const hash = createHash('sha256').update(canonical(body)).digest('hex');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.organizationId}/${operation}/${key}`]);
  const existing = (await db.query('SELECT request_hash,response FROM idempotency WHERE organization_id=$1 AND operation=$2 AND key=$3',[actor.organizationId,operation,key])).rows[0];
  if (existing) {
    requireThat(existing.request_hash === hash,'IDEMPOTENCY_CONFLICT','Этот ключ уже использован с другими условиями');
    return existing.response as T;
  }
  const result = await run();
  await db.query('INSERT INTO idempotency(organization_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5)',[actor.organizationId,operation,key,hash,JSON.stringify(result)]);
  return result;
}
