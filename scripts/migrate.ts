import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { validateDatabase, origin } from '../src/server/config';
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL не задан');
validateDatabase(url);
const pool = new Pool({ connectionString: url });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('narxpilot-migrations'))");
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount) continue;
    await db.query(await readFile(`db/migrations/${file}`,'utf8'));
    await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);
    console.log(`Миграция: ${file}`);
  }
  await db.query('INSERT INTO database_identity(singleton,data_origin) VALUES(true,$1) ON CONFLICT DO NOTHING',[origin()]);
  const identity = (await db.query('SELECT data_origin FROM database_identity')).rows[0];
  if (identity.data_origin !== origin()) throw new Error('Режим существующей базы не совпадает');
  await db.query('COMMIT');
} catch(e) { await db.query('ROLLBACK'); throw e; }
finally { db.release(); await pool.end(); }
