"""Интеграционные проверки реального PostgreSQL, только отдельная *_test база."""
import asyncio
import json
import os
import unittest
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlparse
try:import asyncpg
except ImportError:asyncpg=None

URL=os.getenv('TEST_DATABASE_URL','')
@unittest.skipUnless(URL and asyncpg,'Нужны TEST_DATABASE_URL и asyncpg')
class DatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not urlparse(URL).path.startswith('/narxpilot_test'):raise RuntimeError('Только narxpilot_test')
        self.db=await asyncpg.connect(URL)
        await self.db.set_type_codec('jsonb',schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
        await self.db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())')
        for path in sorted(Path('db/migrations').glob('*.sql')):
            if not await self.db.fetchval('SELECT 1 FROM schema_migrations WHERE name=$1',path.name):
                async with self.db.transaction():
                    await self.db.execute(path.read_text(encoding='utf8'))
                    await self.db.execute('INSERT INTO schema_migrations(name) VALUES($1)',path.name)
        await self.db.execute("INSERT INTO database_identity(singleton,data_origin) VALUES(true,'synthetic') ON CONFLICT DO NOTHING")
        self.supplier=uuid4();self.buyer=uuid4();self.sku=uuid4();self.warehouse=uuid4();self.offer=uuid4();self.order=uuid4();self.user=uuid4()
        await self.db.execute("INSERT INTO organizations(id,name,kind) VALUES($1,'Поставщик тест','supplier'),($2,'Покупатель тест','buyer')",self.supplier,self.buyer)
        await self.db.execute("INSERT INTO users(id,name,is_demo) VALUES($1,'Тест',true)",self.user)
        await self.db.execute("INSERT INTO locations(id,name) VALUES('malika','Малика') ON CONFLICT DO NOTHING")
        await self.db.execute("INSERT INTO skus(id,code,category,brand,model,variant,region,warranty) VALUES($1,$2,'phone','test',$2,'128','Global','12')",self.sku,str(self.sku))
        await self.db.execute("INSERT INTO warehouses(id,organization_id,location_id,name) VALUES($1,$2,'malika','Тестовый склад')",self.warehouse,self.supplier)
        await self.db.execute('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,10,now())',self.warehouse,self.sku)
        await self.db.execute("INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,'synthetic')",self.offer,self.supplier,self.sku,self.warehouse)
        await self.db.execute("INSERT INTO offer_versions(offer_id,version,unit_price,delivery,last_verified_at,valid_until) VALUES($1,1,8000000.15,35000.10,now(),now()+interval '1 day')",self.offer)
        await self.db.execute("INSERT INTO orders(id,buyer_id,supplier_id,sku_id,warehouse_id,offer_id,status,quantity,snapshot,data_origin) VALUES($1,$2,$3,$4,$5,$6,'REQUESTED',5,'{}','synthetic')",self.order,self.buyer,self.supplier,self.sku,self.warehouse,self.offer)
    async def asyncTearDown(self):await self.db.close()
    async def test_migrations_are_applied_and_integration_table_removed(self):
        self.assertGreaterEqual(await self.db.fetchval('SELECT count(*) FROM schema_migrations'),3)
        self.assertIsNone(await self.db.fetchval("SELECT to_regclass('public.integration_connections')"))
    async def test_numeric_preserves_money(self):
        value=await self.db.fetchval('SELECT unit_price*5+delivery FROM offer_versions WHERE offer_id=$1',self.offer)
        self.assertEqual(str(value),'40035000.85')
    async def test_last_item_concurrent_atomic_reservation(self):
        await self.db.execute('UPDATE inventory_balances SET on_hand=1 WHERE warehouse_id=$1 AND sku_id=$2',self.warehouse,self.sku)
        async def reserve():
            conn=await asyncpg.connect(URL)
            try:
                return await conn.fetchval('UPDATE inventory_balances SET reserved=reserved+1 WHERE warehouse_id=$1 AND sku_id=$2 AND on_hand-reserved>=1 RETURNING reserved',self.warehouse,self.sku)
            finally:await conn.close()
        results=await asyncio.gather(reserve(),reserve())
        self.assertEqual(sum(r is not None for r in results),1)
        self.assertEqual(await self.db.fetchval('SELECT on_hand-reserved FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',self.warehouse,self.sku),0)
    async def test_db_prevents_negative_or_oversold_stock(self):
        for sql in ['UPDATE inventory_balances SET on_hand=-1 WHERE warehouse_id=$1','UPDATE inventory_balances SET reserved=11 WHERE warehouse_id=$1']:
            with self.assertRaises(asyncpg.CheckViolationError):await self.db.execute(sql,self.warehouse)
    async def test_data_origins_cannot_be_mixed(self):
        with self.assertRaises(asyncpg.RaiseError):await self.db.execute("UPDATE offers SET data_origin='live' WHERE id=$1",self.offer)
    async def test_offer_history_immutable(self):
        with self.assertRaises(asyncpg.RaiseError):await self.db.execute('UPDATE offer_versions SET unit_price=1 WHERE offer_id=$1',self.offer)
    async def test_accepted_order_terms_immutable(self):
        await self.db.execute("UPDATE orders SET quote='{}',quote_version=1,accepted_quote_version=1 WHERE id=$1",self.order)
        with self.assertRaises(asyncpg.RaiseError):await self.db.execute("UPDATE orders SET quote='{\"total\":\"1\"}' WHERE id=$1",self.order)
    async def test_event_duplicate_and_append_only(self):
        eid=uuid4()
        sql="INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,source_type,data_origin,payload) VALUES($1,'ReceiptAccepted',$2,$3,1,$4,'test','synthetic','{}') ON CONFLICT DO NOTHING"
        for _ in range(2):await self.db.execute(sql,eid,self.supplier,self.order,self.sku)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM business_events WHERE event_id=$1',eid),1)
        with self.assertRaises(asyncpg.RaiseError):await self.db.execute("UPDATE business_events SET payload='{}' WHERE event_id=$1",eid)
    async def reserved(self,expired=True):
        await self.db.execute("UPDATE orders SET status='RESERVED',quote='{}',quote_version=1,accepted_quote_version=1 WHERE id=$1",self.order)
        await self.db.execute('UPDATE inventory_balances SET reserved=5 WHERE warehouse_id=$1 AND sku_id=$2',self.warehouse,self.sku)
        await self.db.execute("INSERT INTO reservations(order_id,warehouse_id,sku_id,quantity,status,expires_at) VALUES($1,$2,$3,5,'active',now()+$4*interval '1 minute')",self.order,self.warehouse,self.sku,-1 if expired else 1)
    async def test_expiry_is_idempotent_and_preserves_stock(self):
        await self.reserved()
        await self.db.execute('SELECT expire_reservations()');await self.db.execute('SELECT expire_reservations()')
        self.assertEqual(await self.db.fetchval('SELECT status FROM orders WHERE id=$1',self.order),'EXPIRED')
        self.assertEqual(await self.db.fetchval('SELECT reserved FROM inventory_balances WHERE warehouse_id=$1 AND sku_id=$2',self.warehouse,self.sku),0)
        self.assertEqual(await self.db.fetchval("SELECT count(*) FROM business_events WHERE aggregate_id=$1 AND type='ReservationExpired'",self.order),1)
    async def test_shipped_order_cannot_be_expired(self):
        await self.reserved()
        await self.db.execute("UPDATE orders SET status='SHIPPED' WHERE id=$1",self.order)
        await self.db.execute("UPDATE reservations SET status='consumed' WHERE order_id=$1",self.order)
        await self.db.execute('UPDATE inventory_balances SET reserved=0,on_hand=5 WHERE warehouse_id=$1 AND sku_id=$2',self.warehouse,self.sku)
        await self.db.execute('SELECT expire_reservations()')
        self.assertEqual(await self.db.fetchval('SELECT status FROM orders WHERE id=$1',self.order),'SHIPPED')
    async def test_notifications_deduplicate(self):
        for _ in range(2):await self.db.execute("INSERT INTO notifications(organization_id,delivery_key,title,body) VALUES($1,'same','Title','body') ON CONFLICT DO NOTHING",self.buyer)
        self.assertEqual(await self.db.fetchval('SELECT count(*) FROM notifications WHERE organization_id=$1',self.buyer),1)
    async def test_worker_replay_and_late_return_recalculate_original_fact(self):
        from worker.main import _process_once
        os.environ['DEMO_MODE']='true';os.environ['WORKER_FAIL_FAST']='true'
        eid=uuid4();payload={'order_id':str(self.order),'supplier_id':str(self.supplier),'quantity':5,'unit_price':'8000000.15','terms_group':'2-9','currency':'UZS','payment_terms':'bank_transfer','price_basis':'seller_final','location':'malika'}
        await self.db.execute("INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,source_type,data_origin,payload) VALUES($1,'ReceiptAccepted',$2,$3,1,$4,$5,now()-interval '1 day','test','synthetic',$6)",eid,self.supplier,self.order,self.sku,self.warehouse,payload)
        await self.db.execute('INSERT INTO outbox(event_id) VALUES($1)',eid)
        await _process_once(URL)
        async def snapshot():return await self.db.fetchval("SELECT payload FROM analytics_snapshots WHERE sku_id=$1 AND scope=$2 AND cohort='all|2-9'",self.sku,'own:'+str(self.supplier))
        first=await snapshot();self.assertEqual(sum(r['units_sold_net'] or 0 for r in first['series']),5)
        await self.db.execute('UPDATE outbox SET processed_at=NULL WHERE event_id=$1',eid)
        await _process_once(URL);again=await snapshot();self.assertEqual(first['series'],again['series'])
        returned=uuid4();payload={'order_id':str(self.order),'quantity':2,'resalable':True,'on_hand_delta':2,'reserved_delta':0}
        await self.db.execute("INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,source_type,data_origin,payload) VALUES($1,'ReturnAccepted',$2,$3,2,$4,$5,'test','synthetic',$6)",returned,self.supplier,self.order,self.sku,self.warehouse,payload)
        await self.db.execute('INSERT INTO outbox(event_id) VALUES($1)',returned)
        await _process_once(URL);result=await snapshot();self.assertEqual(sum(r['units_sold_net'] or 0 for r in result['series']),3)
        self.assertIsNotNone(await self.db.fetchval('SELECT processed_at FROM outbox WHERE event_id=$1',returned))
    async def test_worker_does_not_acknowledge_future_event(self):
        from worker.main import _process_once
        os.environ['DEMO_MODE']='true';os.environ['WORKER_FAIL_FAST']='true'
        eid=uuid4()
        await self.db.execute("INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,source_type,data_origin,payload,recorded_at) VALUES($1,'SourceReconciled',$2,$3,1,$4,'test','synthetic','{}',now()+interval '1 day')",eid,self.supplier,self.order,self.sku)
        await self.db.execute('INSERT INTO outbox(event_id) VALUES($1)',eid)
        await _process_once(URL)
        self.assertIsNone(await self.db.fetchval('SELECT processed_at FROM outbox WHERE event_id=$1',eid))
    async def test_worker_role_cannot_change_prices_or_memberships(self):
        role='np_test_worker_'+uuid4().hex
        await self.db.execute(f'CREATE ROLE {role} NOLOGIN')
        try:
            await self.db.execute(f'GRANT USAGE ON SCHEMA public TO {role}')
            await self.db.execute(f'GRANT SELECT ON database_identity,warehouses,business_events,outbox,analytics_snapshots TO {role}')
            await self.db.execute(f'GRANT INSERT,UPDATE ON analytics_snapshots TO {role}')
            await self.db.execute(f'GRANT UPDATE ON outbox TO {role}')
            await self.db.execute(f'GRANT EXECUTE ON FUNCTION expire_reservations() TO {role}')
            await self.db.execute(f'SET ROLE {role}')
            self.assertEqual(await self.db.fetchval('SELECT data_origin FROM database_identity'),'synthetic')
            with self.assertRaises(asyncpg.InsufficientPrivilegeError):await self.db.execute('UPDATE offers SET current_version=2 WHERE id=$1',self.offer)
            with self.assertRaises(asyncpg.InsufficientPrivilegeError):await self.db.execute("UPDATE memberships SET role='admin'")
            await self.db.execute('SELECT expire_reservations()')
        finally:
            await self.db.execute('RESET ROLE')
            await self.db.execute(f'DROP OWNED BY {role}')
            await self.db.execute(f'DROP ROLE {role}')

if __name__=='__main__':unittest.main()
