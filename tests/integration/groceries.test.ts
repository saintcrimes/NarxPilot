import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pool,query} from '../../src/server/db';
import {products,offers} from '../../src/server/catalog';
import {createOrder,orderAction,getOrder} from '../../src/server/orders';
import {seedDemo,demoId} from '../../scripts/seed';
import {total} from '../../src/domain/money';
import type {Actor} from '../../src/domain/types';

process.env.DEMO_MODE='true';process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
if(!process.env.DATABASE_URL||!/^\/narxpilot_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname))throw new Error('Нужна отдельная TEST_DATABASE_URL=.../narxpilot_test');
before(async()=>{
  await pool().query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(file=>file.endsWith('.sql')).sort())if(!(await pool().query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount){await pool().query(await readFile('db/migrations/'+file,'utf8'));await pool().query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);}
  await pool().query("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING");
  await seedDemo();
});
after(async()=>{await pool().end();});

test('Продуктовый каталог показывает точные упаковки и скрывает архивную электронику без удаления',async()=>{
  const visible=await products();assert.equal(visible.length,10);assert.ok(visible.every(item=>item.code.startsWith('GR-')&&item.catalog_visible&&item.condition==='packaged'));
  const flour=await products('GR-001');assert.equal(flour[0].model,'Мука пшеничная высший сорт');assert.equal(flour[0].variant,'2 кг');assert.equal(flour[0].unit,'уп.');
  for(const search of ['Makfa 2 кг','Makfa2kg','flour2kg','bugdoyuni2kg','GR001'])assert.deepEqual((await products(search)).map(item=>item.code),['GR-001'],search);
  assert.equal((await products('Makfa 1 kg')).length,0);
  assert.equal((await products('iPhone')).length,0);
  const old=(await query('SELECT code,catalog_visible FROM skus WHERE id=$1',[demoId('sku0')]))[0];assert.equal(old.code,'NP-001');assert.equal(old.catalog_visible,false);
  assert.ok((await query("SELECT count(*)::integer n FROM business_events WHERE source_id='seed-v1'"))[0].n>0);
});

test('Заказ сохраняет цену за упаковку, количество упаковок и единицу в согласованном снимке',async()=>{
  const sku=demoId('grocery-GR-001'),available=await offers(sku,5,'food_city');assert.equal(available.length,3);assert.ok(available.every(item=>item.unit==='уп.'));
  const selected=available[0];
  const buyer:Actor={userId:demoId('user-buyer'),organizationId:demoId('buyer'),role:'buyer'};
  const supplier:Actor={userId:demoId('user-grocer0'),organizationId:demoId('grocer0'),role:'supplier'};
  const order=await createOrder(buyer,{skuId:sku,offerId:selected.id,quantity:5},randomUUID());
  assert.equal(order.snapshot.unit,'уп.');assert.equal(order.snapshot.quantity,5);
  assert.equal(order.snapshot.total,total(selected.unit_price,5,selected.delivery,selected.fees));
  const quoted=await orderAction(supplier,order.id,'quote',{unitPrice:selected.unit_price,delivery:selected.delivery!,fees:selected.fees},randomUUID());
  assert.equal(quoted.quote?.unit,'уп.');await orderAction(buyer,order.id,'accept',{quoteVersion:quoted.quote_version},randomUUID());
  assert.equal((await getOrder(buyer,order.id)).quote?.unit,'уп.');
  await orderAction(buyer,order.id,'cancel',{reason:'Проверка завершена'},randomUUID());
});

test('Повторный grocery seed сохраняет операционные изменения и исходную историю',async()=>{
  const warehouse=demoId('grocery-warehouse0'),sku=demoId('grocery-GR-001');
  const oldStock=(await query('SELECT on_hand FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku]))[0].on_hand;
  await query('UPDATE inventory_balances SET on_hand=on_hand+3 WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku]);
  const capture=async()=>({
    counts:(await query(`SELECT (SELECT count(*)::integer FROM skus) skus,(SELECT count(*)::integer FROM business_events) events,(SELECT count(*)::integer FROM orders) orders,(SELECT count(*)::integer FROM outbox) outbox`))[0],
    stock:(await query('SELECT * FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku]))[0],
    oldEvents:(await query("SELECT count(*)::integer n,max(recorded_at) last_recorded FROM business_events WHERE source_id='seed-v1'"))[0],
    oldOrders:await query("SELECT id,snapshot,quote,status FROM orders WHERE sku_id=$1 ORDER BY id",[demoId('sku0')])
  });
  try{const saved=await capture();await seedDemo();await seedDemo();assert.deepEqual(await capture(),saved);}
  finally{await query('UPDATE inventory_balances SET on_hand=$3 WHERE warehouse_id=$1 AND sku_id=$2',[warehouse,sku,oldStock]);}
});
