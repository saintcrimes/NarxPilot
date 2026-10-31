import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { pool,query,transaction } from '../../src/server/db';
import { createOrder,orderAction,getOrder } from '../../src/server/orders';
import { updateOffer,inventoryAction } from '../../src/server/inventory';
import { notify } from '../../src/server/events';
import { seedDemo,demoId } from '../../scripts/seed';
import { previewCsv,importCsv } from '../../src/server/csv';
import { explain } from '../../src/server/assistant';
import { offers } from '../../src/server/catalog';
import type { Actor } from '../../src/domain/types';
process.env.DEMO_MODE='true';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
if(!process.env.DATABASE_URL||!/^\/narxpilot_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname))throw new Error('Нужна отдельная TEST_DATABASE_URL=.../narxpilot_test');
const buyer:Actor={userId:demoId('user-buyer'),organizationId:demoId('buyer'),role:'buyer'};
const buyer2:Actor={userId:demoId('user-buyer2'),organizationId:demoId('buyer2'),role:'buyer'};
const seller:Actor={userId:demoId('user-supplier0'),organizationId:demoId('supplier0'),role:'supplier'};
const foreign:Actor={userId:demoId('user-supplier1'),organizationId:demoId('supplier1'),role:'supplier'};
const skuId=demoId('sku0'),offerId=demoId('offer0-0');
before(async()=>{
  await pool().query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())if(!(await pool().query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount){await pool().query(await readFile('db/migrations/'+file,'utf8'));await pool().query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);}
  await pool().query("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING");
  await seedDemo();
});
after(async()=>{await pool().end();});
const key=()=>randomUUID();
async function requested(quantity=5,who=buyer){return createOrder(who,{skuId,offerId,quantity},key());}
async function quoted(quantity=5,who=buyer){const o=await requested(quantity,who);return orderAction(seller,o.id,'quote',{unitPrice:'8000000.15',delivery:'35000.10'},key());}
async function completed(){const o=await quoted();await orderAction(buyer,o.id,'accept',{quoteVersion:o.quote_version},key());await orderAction(seller,o.id,'ship',{},key());await orderAction(buyer,o.id,'receive',{},key());return o;}
test('A03–A09: полный цикл, снимок, outbox, отсутствие выдуманной экономии',async()=>{
  const o=await quoted();assert.equal(o.status,'QUOTED');assert.equal(o.quote?.total,'40035000.85');
  await orderAction(buyer,o.id,'accept',{quoteVersion:o.quote_version},key());
  assert.equal((await query("SELECT count(*)::int n FROM business_events WHERE aggregate_id=$1 AND type='ReceiptAccepted'",[o.id]))[0].n,0);
  await orderAction(seller,o.id,'ship',{},key());
  assert.equal((await query("SELECT count(*)::int n FROM business_events WHERE aggregate_id=$1 AND type='ReceiptAccepted'",[o.id]))[0].n,0);
  await orderAction(buyer,o.id,'receive',{},key());const result=await getOrder(buyer,o.id);
  assert.equal(result.status,'COMPLETED');assert.equal(result.actual_savings,null);
  assert.equal((await query("SELECT count(*)::int n FROM outbox b JOIN business_events e USING(event_id) WHERE e.aggregate_id=$1 AND e.type='ReceiptAccepted'",[o.id]))[0].n,1);
});
test('A04: новое согласие обязательно после изменения котировки',async()=>{
  const o=await quoted();await orderAction(seller,o.id,'quote',{unitPrice:'8100000',delivery:'40000'},key());
  await assert.rejects(orderAction(buyer,o.id,'accept',{quoteVersion:o.quote_version},key()),/изменились/);
  assert.equal((await getOrder(buyer,o.id)).status,'QUOTED');
});
test('C02: одинаковый ключ возвращает один заказ, другой payload конфликтует',async()=>{
  const idempotencyKey=key();const body={skuId,offerId,quantity:5};
  const results=await Promise.all([createOrder(buyer,body,idempotencyKey),createOrder(buyer,body,idempotencyKey)]);
  assert.equal(results[0].id,results[1].id);await assert.rejects(createOrder(buyer,{...body,quantity:6},idempotencyKey),/другими условиями/);
});
test('C01: две конкурирующие покупки последней единицы',async()=>{
  const stock=(await query('SELECT * FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[demoId('warehouse0'),skuId]))[0];
  await query('UPDATE inventory_balances SET on_hand=reserved+1 WHERE warehouse_id=$1 AND sku_id=$2',[demoId('warehouse0'),skuId]);
  try{const a=await quoted(1),b=await quoted(1,buyer2);
    const results=await Promise.allSettled([orderAction(buyer,a.id,'accept',{quoteVersion:a.quote_version},key()),orderAction(buyer2,b.id,'accept',{quoteVersion:b.quote_version},key())]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const won=results[0].status==='fulfilled'?{id:a.id,actor:buyer}:{id:b.id,actor:buyer2};await orderAction(won.actor,won.id,'cancel',{},key());
  }finally{await query('UPDATE inventory_balances SET on_hand=$3 WHERE warehouse_id=$1 AND sku_id=$2',[demoId('warehouse0'),skuId,stock.on_hand]);}
});
test('C05: отмена освобождает резерв ровно один раз',async()=>{
  const o=await quoted();await orderAction(buyer,o.id,'accept',{quoteVersion:o.quote_version},key());const k=key();
  await orderAction(buyer,o.id,'cancel',{},k);await orderAction(buyer,o.id,'cancel',{},k);
  assert.equal((await query("SELECT count(*)::int n FROM business_events WHERE aggregate_id=$1 AND type='ReservationReleased'",[o.id]))[0].n,1);
});
test('C07/C08: возврат требует поставщика, дефект попадает в карантин',async()=>{
  const o=await completed();await orderAction(buyer,o.id,'return-request',{quantity:2,resalable:false,reason:'Проверка дефекта'},key());
  const r=(await getOrder(buyer,o.id)).returns[0];
  await assert.rejects(orderAction(buyer,o.id,'return-accept',{returnId:r.id},key()),/роли/);
  const before=(await query('SELECT on_hand,quarantine FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[o.warehouse_id,skuId]))[0];
  await orderAction(seller,o.id,'return-accept',{returnId:r.id},key());
  const after=(await query('SELECT on_hand,quarantine FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',[o.warehouse_id,skuId]))[0];
  assert.equal(after.on_hand,before.on_hand);assert.equal(after.quarantine,before.quarantine+2);
  await assert.rejects(orderAction(buyer,o.id,'return-request',{quantity:4,resalable:true,reason:'Слишком много'},key()),/больше принятого/);
});
test('C09: истекшая котировка не резервирует товар',async()=>{const o=await quoted();await query("UPDATE orders SET quote_expires_at=now()-interval '1 minute' WHERE id=$1",[o.id]);await assert.rejects(orderAction(buyer,o.id,'accept',{quoteVersion:o.quote_version},key()),/истекла/);});
test('D01/D02: чужие заказы, предложения и склады недоступны',async()=>{
  const o=await requested();await assert.rejects(getOrder(buyer2,o.id),/не найден/);await assert.rejects(orderAction(foreign,o.id,'quote',{unitPrice:'1',delivery:'0'},key()),/не найден/);
  await assert.rejects(updateOffer(foreign,offerId,{unitPrice:'1',delivery:'0',fees:'0',minQuantity:1,deliveryDays:1},key()),/не найден/);
  await assert.rejects(inventoryAction(foreign,{warehouseId:demoId('warehouse0'),skuId,kind:'receive',quantity:1,reason:'Тест'},key()),/не найден/);
});
test('D07: уведомления дедуплицируются и выключенный канал ничего не отправляет',async()=>{
  const k=key();await transaction(async db=>{await notify(db,buyer.organizationId,k,'Тест','Тест');await notify(db,buyer.organizationId,k,'Тест','Тест');});
  assert.equal((await query('SELECT count(*)::int n FROM notifications WHERE delivery_key=$1',[k]))[0].n,1);
  process.env.NOTIFICATION_CHANNEL='disabled';const disabled=key();try{await transaction(db=>notify(db,buyer.organizationId,disabled,'Тест','Тест'));assert.equal((await query('SELECT count(*)::int n FROM notifications WHERE delivery_key=$1',[disabled]))[0].n,0);}finally{delete process.env.NOTIFICATION_CHANNEL;}
});
test('CSV: preview не пишет, чужой ID отклоняется, повтор импорта идемпотентен',async()=>{
  const csv=`offerId,unitPrice,delivery,fees,minQuantity,deliveryDays\n${offerId},8000000,35000,0,1,1`;
  const version=(await query('SELECT current_version FROM offers WHERE id=$1',[offerId]))[0].current_version;
  assert.equal((await previewCsv(seller,csv))[0].error,null);assert.equal((await query('SELECT current_version FROM offers WHERE id=$1',[offerId]))[0].current_version,version);
  assert.ok((await previewCsv(foreign,csv))[0].error);const k=key();await importCsv(seller,csv,k);await importCsv(seller,csv,k);
  assert.equal((await query('SELECT current_version FROM offers WHERE id=$1',[offerId]))[0].current_version,version+1);
});
test('A10: без ключа LLM используется честный шаблон',async()=>{
  process.env.LLM_PROVIDER='disabled';const result=await explain(buyer,skuId);assert.equal(result.provider,'template');assert.equal(result.is_ai,false);
  assert.equal(result.sku_id,skuId);assert.equal(result.cohort,'all|2-9');
  const filtered=await explain(buyer,skuId,'malika','10+');assert.equal(filtered.cohort,'malika|10+');assert.equal(filtered.is_ai,false);
});
test('A02: просроченное предложение помечено сервером и скрыто из актуального сравнения',async()=>{
  const expiredId=randomUUID();
  await transaction(async db=>{
    await db.query("INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,'synthetic')",[expiredId,seller.organizationId,skuId,demoId('warehouse0')]);
    await db.query("INSERT INTO offer_versions(offer_id,version,unit_price,delivery,last_verified_at,valid_until) VALUES($1,1,7900000,0,now()-interval '2 hours',now()-interval '1 hour')",[expiredId]);
  });
  assert.equal((await offers(skuId,5)).some(o=>o.id===expiredId),false);
  const expired=(await offers(skuId,5,'all',undefined,true)).find(o=>o.id===expiredId);
  assert.ok(expired);assert.equal(expired.expired,true);assert.equal(expired.eligible,false);
  assert.equal((await offers(skuId,5)).find(o=>o.id===offerId)?.expired,false);
});
