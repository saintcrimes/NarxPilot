import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { pool,query } from '../../src/server/db';
import { seedDemo,demoId } from '../../scripts/seed';

process.env.DEMO_MODE='true';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
if(!process.env.DATABASE_URL||!/^\/narxpilot_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname))throw new Error('Нужна отдельная TEST_DATABASE_URL=.../narxpilot_test');
before(async()=>{
  await pool().query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(file=>file.endsWith('.sql')).sort())if(!(await pool().query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount){await pool().query(await readFile('db/migrations/'+file,'utf8'));await pool().query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);}
  await pool().query("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING");
  await seedDemo();
});
after(async()=>{await pool().end();});

test('Расширение seed добавляет три категории и только начальные события без истории продаж',async()=>{
  const ids=[10,11,12].map(index=>demoId('sku'+index));
  const products=await query('SELECT code,category FROM skus WHERE id=ANY($1::uuid[]) ORDER BY code',[ids]);
  assert.deepEqual(products,[{code:'NP-011',category:'Компьютеры'},{code:'NP-012',category:'Принтеры'},{code:'NP-013',category:'Бытовая техника'}]);
  const offers=await query("SELECT count(*)::int n FROM offers WHERE sku_id=ANY($1::uuid[]) AND data_origin='synthetic'",[ids]);assert.equal(offers[0].n,15);
  const facts=await query("SELECT type,count(*)::int n FROM business_events WHERE sku_id=ANY($1::uuid[]) AND source_id='seed-catalog-v2' GROUP BY type ORDER BY type",[ids]);
  assert.deepEqual(facts,[{type:'InventoryReceived',n:15},{type:'OfferPublished',n:15},{type:'SourceReconciled',n:15}]);
  assert.equal((await query("SELECT count(*)::int n FROM business_events WHERE sku_id=ANY($1::uuid[]) AND type IN ('ReceiptAccepted','OrderShipped')",[ids]))[0].n,0);
  assert.equal((await query("SELECT count(*)::int n FROM outbox o JOIN business_events e USING(event_id) WHERE e.source_id='seed-catalog-v2'",[]))[0].n,45);
});
test('Два повторных seed не меняют старые данные, текущие остатки, предложения или число событий',async()=>{
  const warehouse=demoId('warehouse0'),sku=demoId('sku10');
  const original=(await query('SELECT on_hand FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku]))[0].on_hand;
  await query('UPDATE inventory_balances SET on_hand=on_hand+7 WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku]);
  const snapshot=async()=>({
    counts:(await query(`SELECT (SELECT count(*)::int FROM skus) skus,(SELECT count(*)::int FROM offers) offers,
      (SELECT count(*)::int FROM business_events) events,(SELECT count(*)::int FROM outbox) outbox,(SELECT count(*)::int FROM orders) orders`))[0],
    balances:await query('SELECT * FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=ANY($2::uuid[]) ORDER BY sku_id',[warehouse,[demoId('sku0'),sku]]),
    offers:await query('SELECT o.*,v.* FROM offers o JOIN offer_versions v ON v.offer_id=o.id AND v.version=o.current_version WHERE o.id=ANY($1::uuid[]) ORDER BY o.id',[[demoId('offer0-0'),demoId('offer10-0')]])
  });
  try{const before=await snapshot();await seedDemo();await seedDemo();assert.deepEqual(await snapshot(),before);}
  finally{await query('UPDATE inventory_balances SET on_hand=$3 WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku,original]);}
});
