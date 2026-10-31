import 'dotenv/config';
import { Pool } from 'pg';
import { validateDatabase } from '../src/server/config';
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('MIGRATION_DATABASE_URL обязателен');
const name=validateDatabase(url);if(!/^[a-z0-9_]+$/.test(name))throw new Error('Небезопасное имя базы');
const pool=new Pool({connectionString:url});
try {
  for(const [role,password] of [['narxpilot_web',process.env.WEB_DB_PASSWORD],['narxpilot_worker',process.env.WORKER_DB_PASSWORD]]) {
    if(!password||!/^[a-zA-Z0-9]{32,}$/.test(password))throw new Error('Пароль роли: минимум 32 букв/цифр');
    const found=await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    if(!found.rowCount)await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    else await pool.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
    await pool.query(`GRANT CONNECT ON DATABASE "${name}" TO ${role}`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  }
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO narxpilot_web;
    GRANT INSERT,UPDATE ON orders,reservations,inventory_balances,returns,offers,alert_rules,notifications,rate_limits TO narxpilot_web;
    GRANT INSERT ON offer_versions,shipments,receipts,business_events,outbox,idempotency,audit_log TO narxpilot_web;
    GRANT SELECT ON database_identity,skus,warehouses,business_events,analytics_snapshots,outbox TO narxpilot_worker;
    GRANT INSERT,UPDATE ON analytics_snapshots,forecast_runs TO narxpilot_worker;
    GRANT UPDATE ON outbox TO narxpilot_worker;
    GRANT EXECUTE ON FUNCTION expire_reservations() TO narxpilot_worker`);
  console.log('Права web и worker настроены.');
} finally {await pool.end();}
