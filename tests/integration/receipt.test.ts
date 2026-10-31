import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { pool,query } from '../../src/server/db';
import { seedDemo,demoId } from '../../scripts/seed';
import { createOrder,orderAction } from '../../src/server/orders';
import { orderReceipt } from '../../src/server/receipt';
import type { Actor } from '../../src/domain/types';
process.env.DEMO_MODE='true';process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
if(!process.env.DATABASE_URL||!/^\/narxpilot_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname))throw new Error('Нужна отдельная TEST_DATABASE_URL=.../narxpilot_test');
before(async()=>{
  await pool().query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(file=>file.endsWith('.sql')).sort())if(!(await pool().query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount){await pool().query(await readFile('db/migrations/'+file,'utf8'));await pool().query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);}
  await pool().query("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING");await seedDemo();
});
after(async()=>{await pool().end();});
test('Сводка хранит точные суммы котировки, защищена организацией и не создаёт событий',async()=>{
  const buyer:Actor={userId:demoId('user-buyer'),organizationId:demoId('buyer'),role:'buyer'};
  const supplier:Actor={userId:demoId('user-supplier0'),organizationId:demoId('supplier0'),role:'supplier'};
  const other:Actor={userId:demoId('user-buyer2'),organizationId:demoId('buyer2'),role:'buyer'};
  const order=await createOrder(buyer,{skuId:demoId('sku10'),offerId:demoId('offer10-0'),quantity:5},randomUUID());
  const initial=await orderReceipt(buyer,order.id);assert.equal(initial.terms_source,'request_snapshot');assert.equal(initial.terms.total,order.snapshot.total);
  await orderAction(supplier,order.id,'quote',{unitPrice:'12000000.15',delivery:'45000.10',fees:'10.25'},randomUUID());
  const count=(await query('SELECT count(*)::int n FROM business_events WHERE aggregate_id=$1',[order.id]))[0].n;
  const receipt=await orderReceipt(buyer,order.id);assert.equal(receipt.terms_source,'supplier_quote');assert.equal(receipt.terms.total,'60045011.10');assert.equal(receipt.product.code,'NP-011');assert.equal(receipt.status,'QUOTED');assert.equal(receipt.demo,true);
  assert.match(receipt.notice,/не подтверждает оплату/);assert.equal(receipt.benchmark.basis,'current_comparable_offers');
  await assert.rejects(orderReceipt(other,order.id),{code:'NOT_FOUND'});
  assert.equal((await query('SELECT count(*)::int n FROM business_events WHERE aggregate_id=$1',[order.id]))[0].n,count);
});
