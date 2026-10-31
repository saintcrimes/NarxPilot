import type { Db } from './db';
import type { Actor } from '../domain/types';
import { origin } from './config';
export async function emit(db: Db, input: {
  type: string; organizationId: string; aggregateId: string; version: number;
  skuId?: string; warehouseId?: string; payload: Record<string, unknown>;
}) {
  const event = (await db.query(`INSERT INTO business_events
    (type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,source_type,data_origin,payload)
    VALUES($1,$2,$3,$4,$5,$6,'platform_order',$7,$8) RETURNING event_id`,
  [input.type,input.organizationId,input.aggregateId,input.version,input.skuId,input.warehouseId,origin(),input.payload])).rows[0];
  await db.query('INSERT INTO outbox(event_id) VALUES($1)',[event.event_id]);
  return event.event_id as string;
}
export async function audit(db: Db, actor: Actor, action: string, objectId: string | null, requestId: string, details = {}) {
  await db.query('INSERT INTO audit_log(actor_id,organization_id,action,object_id,request_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [actor.userId,actor.organizationId,action,objectId,requestId,details]);
}
export async function notify(db: Db, organizationId: string, key: string, title: string, body: string, orderId?: string) {
  if (process.env.NOTIFICATION_CHANNEL === 'disabled') return;
  await db.query(`INSERT INTO notifications(organization_id,delivery_key,title,body,order_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [organizationId,key,title,body,orderId]);
}
