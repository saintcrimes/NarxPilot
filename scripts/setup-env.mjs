import { readFile,writeFile,access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {await access('.env');console.log('.env уже существует; файл сохранён без изменений.');process.exit(0);} catch {}
const values={POSTGRES_PASSWORD:randomBytes(24).toString('hex'),WEB_DB_PASSWORD:randomBytes(24).toString('hex'),WORKER_DB_PASSWORD:randomBytes(24).toString('hex'),SESSION_SECRET:randomBytes(40).toString('hex')};
values.DATABASE_URL=`postgresql://narxpilot_web:${values.WEB_DB_PASSWORD}@localhost:5432/narxpilot_demo`;
values.WORKER_DATABASE_URL=`postgresql://narxpilot_worker:${values.WORKER_DB_PASSWORD}@localhost:5432/narxpilot_demo`;
values.MIGRATION_DATABASE_URL=`postgresql://narxpilot_owner:${values.POSTGRES_PASSWORD}@localhost:5432/narxpilot_demo`;
let text=await readFile('.env.example','utf8');
for(const [key,value] of Object.entries(values))text=text.replace(new RegExp(`^${key}=.*$`,'m'),`${key}=${value}`);
await writeFile('.env',text,{flag:'wx',mode:0o600});console.log('.env создан; секреты не выводятся в журнал. Docker Compose переопределяет адрес БД на db.');
