"""Outbox: транзакционное получение и идемпотентный пересчёт SKU."""
import argparse
import asyncio
import json
import os
import re
import time
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import asyncpg
from .analytics import aggregate

def database_url():
    url = os.environ.get('WORKER_DATABASE_URL') or os.environ['DATABASE_URL']
    name = urlparse(url).path[1:]
    if bool(re.fullmatch(r'narxpilot_(demo|test)(_[a-z0-9]+)?',name)) != (os.environ.get('DEMO_MODE')=='true'):
        raise RuntimeError('Режим и имя базы не совпадают')
    return url

async def _process_once(url):
    expected='synthetic' if os.environ.get('DEMO_MODE')=='true' else 'live'
    processed=0
    conn=await asyncpg.connect(url,server_settings={'timezone':'UTC'},command_timeout=60)
    await conn.set_type_codec('jsonb',schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
    try:
        async with conn.transaction():
            identity=await conn.fetchrow('SELECT data_origin FROM database_identity')
            if not identity or identity['data_origin']!=expected:raise RuntimeError('Неверное происхождение базы')
            await conn.execute("SELECT set_config('app.notifications',$1,true)",os.environ.get('NOTIFICATION_CHANNEL','in_app'))
            await conn.execute('SELECT expire_reservations()')
        sku_ids=await conn.fetch("""SELECT DISTINCT e.sku_id FROM outbox o JOIN business_events e USING(event_id)
          WHERE o.processed_at IS NULL AND o.available_at<=now() AND e.recorded_at<=now() AND e.occurred_at<=now() AND e.sku_id IS NOT NULL
          UNION SELECT sku_id FROM analytics_snapshots
          WHERE (as_of AT TIME ZONE 'Asia/Tashkent')::date < (now() AT TIME ZONE 'Asia/Tashkent')::date""")
        for entry in sku_ids:
            sku=entry['sku_id']
            try:
                async with conn.transaction():
                    locked=await conn.fetchval('SELECT pg_try_advisory_xact_lock(hashtextextended($1,1))',str(sku))
                    if not locked:continue
                    jobs=await conn.fetch("SELECT o.event_id FROM outbox o JOIN business_events e USING(event_id) WHERE e.sku_id=$1 AND o.processed_at IS NULL AND o.available_at<=now() AND e.recorded_at<=now() AND e.occurred_at<=now() FOR UPDATE OF o SKIP LOCKED",sku)
                    if not jobs:
                        stale=await conn.fetchval("SELECT EXISTS(SELECT 1 FROM analytics_snapshots WHERE sku_id=$1 AND (as_of AT TIME ZONE 'Asia/Tashkent')::date < (now() AT TIME ZONE 'Asia/Tashkent')::date)",sku)
                        if not stale:continue
                    cutoff=await conn.fetchval('SELECT clock_timestamp()')
                    events=await conn.fetch('SELECT * FROM business_events WHERE sku_id=$1 AND recorded_at<=$2 ORDER BY occurred_at,event_id',sku,cutoff)
                    warehouses={str(w['id']):w for w in await conn.fetch('SELECT * FROM warehouses')}
                    event_warehouses={str(e['warehouse_id']) for e in events}
                    suppliers={str(w['organization_id']) for w in warehouses.values() if str(w['id']) in event_warehouses}
                    for supplier in [None,*sorted(suppliers)]:
                        scope='platform' if supplier is None else 'own:'+supplier
                        for location in ['all','malika','chilanzar','food_city','sergeli']:
                            for terms in ['1','2-9','10+']:
                                payload=aggregate(events,cutoff,scope='platform' if supplier is None else 'own',supplier=supplier,location=location,terms=terms,origin=expected,warehouses=warehouses)
                                await conn.execute("""INSERT INTO analytics_snapshots(sku_id,scope,cohort,data_origin,as_of,data_cutoff,metric_definitions_version,payload)
                                  VALUES($1,$2,$3,$4,$5,$6,'1.0',$7)
                                  ON CONFLICT(sku_id,scope,cohort,data_origin) DO UPDATE SET payload=excluded.payload,version=analytics_snapshots.version+1,as_of=excluded.as_of,data_cutoff=excluded.data_cutoff,metric_definitions_version=excluded.metric_definitions_version""",
                                  sku,scope,location+'|'+terms,expected,datetime.now(timezone.utc),cutoff,payload)
                    await conn.execute('UPDATE outbox SET processed_at=now(),attempts=attempts+1,last_error=NULL WHERE event_id=ANY($1::uuid[])',[j['event_id'] for j in jobs])
                    processed+=len(jobs)
            except Exception as exc:
                print(json.dumps({'worker_error':type(exc).__name__,'sku_id':str(sku)}),flush=True)
                async with conn.transaction():
                    await conn.execute("""UPDATE outbox SET attempts=attempts+1,last_error=$1,available_at=now()+least(300,power(2,least(attempts,8)))*interval '1 second'
                      WHERE processed_at IS NULL AND event_id IN(SELECT event_id FROM business_events WHERE sku_id=$2)""",type(exc).__name__,sku)
                if os.environ.get('WORKER_FAIL_FAST')=='true':raise
        await conn.execute('UPDATE outbox SET processed_at=now() WHERE processed_at IS NULL AND event_id IN(SELECT event_id FROM business_events WHERE sku_id IS NULL AND recorded_at<=now() AND occurred_at<=now())')
    finally:
        await conn.close()
    return processed

def process_once(url=None):return asyncio.run(_process_once(url or database_url()))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--once',action='store_true');args=parser.parse_args()
    while True:
        try:
            count=process_once()
            Path(tempfile.gettempdir(),'narxpilot-worker-heartbeat').touch()
            print(json.dumps({'processed_events':count,'at':datetime.now(timezone.utc).isoformat()}),flush=True)
        except Exception as exc:
            print(json.dumps({'worker_error':type(exc).__name__}),flush=True)
            if args.once:raise
        if args.once:break
        time.sleep(int(os.environ.get('OUTBOX_POLL_SECONDS','3')))
