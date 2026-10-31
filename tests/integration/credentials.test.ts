import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { pool,query } from '../../src/server/db';
import { registerAccount,authenticateAccount,memberProfile } from '../../src/server/credentials';
import { seedDemo,demoId } from '../../scripts/seed';
import { createOrder,getOrder } from '../../src/server/orders';
import { inventoryAction } from '../../src/server/inventory';
import type { Actor } from '../../src/domain/types';
process.env.DEMO_MODE='true';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
if(!process.env.DATABASE_URL||!/^\/narxpilot_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname))throw new Error('Нужна отдельная TEST_DATABASE_URL=.../narxpilot_test');
before(async()=>{
  await pool().query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())if(!(await pool().query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount){await pool().query(await readFile('db/migrations/'+file,'utf8'));await pool().query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);}
  await pool().query("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING");
  await seedDemo();
});
after(async()=>{await pool().end();});
const form=(role:'buyer'|'supplier'='buyer')=>({name:'Новый пользователь',email:randomUUID()+'@example.test',password:'Test-password-2026',organizationName:'Новая организация '+randomUUID(),role});

test('Регистрация и повторный вход возвращают приватный профиль и ту же организацию',async()=>{
  const body=form();const profile=await registerAccount(body);
  const stored=(await query('SELECT u.is_demo,c.email,c.password_hash FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.id=$1',[profile.user_id]))[0];
  assert.equal(stored.is_demo,false);assert.equal(stored.email,body.email);assert.notEqual(stored.password_hash,body.password);
  assert.deepEqual(await authenticateAccount({email:body.email.toUpperCase(),password:body.password}),profile);
  assert.deepEqual(await memberProfile(profile.user_id,profile.organization_id),profile);
  assert.equal(await memberProfile(profile.user_id,demoId('buyer')),null);
  assert.equal((await query('SELECT id FROM users WHERE is_demo AND id=$1',[profile.user_id])).length,0);
  for(const input of [{email:body.email,password:'wrong-password'},{email:randomUUID()+'@example.test',password:body.password}])await assert.rejects(authenticateAccount(input),{code:'INVALID_CREDENTIALS',status:401});
});
test('Конкурирующий повтор email создаёт одну организацию и не оставляет пользователя без членства',async()=>{
  const body=form();const results=await Promise.allSettled([registerAccount(body),registerAccount({...body,email:body.email.toUpperCase()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const failure=results.find(r=>r.status==='rejected');assert.equal(failure?.status==='rejected'&&failure.reason.code,'EMAIL_EXISTS');
  assert.equal((await query('SELECT count(*)::int n FROM organizations WHERE name=$1',[body.organizationName]))[0].n,1);
  assert.equal((await query('SELECT count(*)::int n FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE NOT u.is_demo AND m.user_id IS NULL'))[0].n,0);
});
test('Новая организация изолирована от демозаказов и складов; поставщик получает свой пустой склад',async()=>{
  const buyer=await registerAccount(form());const supplier=await registerAccount(form('supplier'));
  const actor:Actor={userId:buyer.user_id,organizationId:buyer.organization_id,role:'buyer'};
  const seller:Actor={userId:supplier.user_id,organizationId:supplier.organization_id,role:'supplier'};
  const order=await createOrder({userId:demoId('user-buyer'),organizationId:demoId('buyer'),role:'buyer'},{skuId:demoId('sku0'),offerId:demoId('offer0-0'),quantity:1},randomUUID());
  await assert.rejects(getOrder(actor,order.id),{code:'NOT_FOUND'});
  await assert.rejects(inventoryAction(seller,{warehouseId:demoId('warehouse0'),skuId:demoId('sku0'),kind:'receive',quantity:1,reason:'Тест'},randomUUID()),{code:'NOT_FOUND'});
  const warehouses=await query('SELECT * FROM warehouses WHERE organization_id=$1',[supplier.organization_id]);
  assert.equal(warehouses.length,1);assert.equal(warehouses[0].location_id,'malika');
  assert.equal((await query('SELECT * FROM inventory_balances WHERE warehouse_id=$1',[warehouses[0].id])).length,0);
  const own=await createOrder(actor,{skuId:demoId('sku0'),offerId:demoId('offer0-0'),quantity:1},randomUUID());assert.equal((await getOrder(actor,own.id)).buyer_id,buyer.organization_id);
});
