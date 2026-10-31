import { transaction, query, type Db } from './db';
import { idempotent } from './idempotency';
import { emit, audit, notify } from './events';
import { requireThat } from '../domain/errors';
import type { Actor } from '../domain/types';
import { money, Decimal } from '../domain/money';
import { origin } from './config';
import { randomUUID } from 'node:crypto';
async function notifyOfferAlerts(db:Db,skuId:string,warehouseId:string,offerId:string,price:string,minQuantity:number) {
  const alerts=(await db.query(`SELECT a.* FROM alert_rules a JOIN warehouses w ON w.id=$2 WHERE a.sku_id=$1 AND a.enabled AND a.threshold IS NOT NULL AND (a.location_id='all' OR a.location_id=w.location_id)`,[skuId,warehouseId])).rows;
  const hour=new Date().toISOString().slice(0,13);
  for(const a of alerts)if(new Decimal(price).lte(a.threshold))await notify(db,a.organization_id,`price:${a.id}:${offerId}:${hour}`,'Цена достигла порога',`${money(price)} UZS/шт.; минимальная партия ${minQuantity}; доставка отдельно. Условия на момент публикации.`);
}
export async function createOffer(actor:Actor,body:{skuId:string;warehouseId:string;unitPrice:string;delivery:string|null;fees:string;minQuantity:number;deliveryDays:number},key:string) {
  requireThat(actor.role==='supplier','FORBIDDEN','Недоступно',403);
  return transaction(db=>idempotent(db,actor,'create-offer',key,body,async()=>{
    const warehouse=(await db.query('SELECT 1 FROM warehouses WHERE id=$1 AND organization_id=$2',[body.warehouseId,actor.organizationId])).rowCount;
    requireThat(warehouse,'NOT_FOUND','Склад не найден',404);
    requireThat((await db.query('SELECT 1 FROM skus WHERE id=$1',[body.skuId])).rowCount,'NOT_FOUND','SKU не найден',404);
    await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[body.warehouseId,body.skuId]);
    const id=randomUUID();
    await db.query('INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,$5)',[id,actor.organizationId,body.skuId,body.warehouseId,origin()]);
    const version=(await db.query(`INSERT INTO offer_versions(offer_id,version,unit_price,delivery,fees,min_quantity,delivery_days,last_verified_at,valid_until)
      VALUES($1,1,$2,$3,$4,$5,$6,now(),now()+interval '24 hours') RETURNING valid_until`,[id,body.unitPrice,body.delivery,body.fees,body.minQuantity,body.deliveryDays])).rows[0];
    await emit(db,{type:'OfferPublished',organizationId:actor.organizationId,aggregateId:id,version:1,skuId:body.skuId,warehouseId:body.warehouseId,payload:{offer_id:id,supplier_id:actor.organizationId,unit_price:money(body.unitPrice),min_quantity:body.minQuantity,valid_until:version.valid_until,currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final'}});
    await notifyOfferAlerts(db,body.skuId,body.warehouseId,id,body.unitPrice,body.minQuantity);
    await audit(db,actor,'OfferPublished',id,key);return {id,version:1};
  }));
}
export async function supplierDashboard(actor:Actor) {
  requireThat(actor.role==='supplier','FORBIDDEN','Кабинет поставщика недоступен',403);
  const stock=await query(`SELECT b.*,k.code,k.model,k.variant,w.name warehouse_name FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN skus k ON k.id=b.sku_id WHERE w.organization_id=$1 ORDER BY k.code`,[actor.organizationId]);
  const offers=await query(`SELECT o.*,v.*,k.model,k.variant FROM offers o JOIN offer_versions v ON v.offer_id=o.id AND v.version=o.current_version JOIN skus k ON k.id=o.sku_id WHERE o.supplier_id=$1 ORDER BY k.code`,[actor.organizationId]);
  const warehouses=await query('SELECT id,name,location_id FROM warehouses WHERE organization_id=$1',[actor.organizationId]);
  return {stock,offers,warehouses};
}
export async function updateOffer(actor:Actor,id:string,body:{unitPrice:string;delivery:string|null;fees:string;minQuantity:number;deliveryDays:number},key:string) {
  requireThat(actor.role==='supplier','FORBIDDEN','Недоступно',403);
  return transaction(db=>idempotent(db,actor,'offer:'+id,key,body,async()=>{
    const o=(await db.query('SELECT * FROM offers WHERE id=$1 AND supplier_id=$2 FOR UPDATE',[id,actor.organizationId])).rows[0];
    requireThat(o,'NOT_FOUND','Предложение не найдено',404);
    const v=o.current_version+1;
    await db.query(`INSERT INTO offer_versions(offer_id,version,unit_price,delivery,fees,min_quantity,delivery_days,last_verified_at,valid_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,now(),now()+$8*interval '1 hour')`,[id,v,money(body.unitPrice),body.delivery===null?null:money(body.delivery),money(body.fees),body.minQuantity,body.deliveryDays,Number(process.env.OFFER_DEFAULT_TTL_HOURS||24)]);
    await db.query('UPDATE offers SET current_version=$2 WHERE id=$1',[id,v]);
    await emit(db,{type:'OfferPublished',organizationId:actor.organizationId,aggregateId:id,version:v,skuId:o.sku_id,warehouseId:o.warehouse_id,
      payload:{offer_id:id,supplier_id:actor.organizationId,unit_price:money(body.unitPrice),min_quantity:body.minQuantity,valid_until:new Date(Date.now()+Number(process.env.OFFER_DEFAULT_TTL_HOURS||24)*3600000).toISOString(),payment_terms:'bank_transfer',price_basis:'seller_final',currency:'UZS'}});
    await notifyOfferAlerts(db,o.sku_id,o.warehouse_id,id,body.unitPrice,body.minQuantity);
    await audit(db,actor,'OfferPublished',id,key,{version:v});
    return {id,version:v};
  }));
}
export async function inventoryAction(actor:Actor,body:{warehouseId:string;skuId:string;kind:'receive'|'writeoff'|'adjust'|'transfer'|'verify'|'external-sale';quantity:number;reason:string;targetWarehouseId?:string},key:string) {
  requireThat(actor.role==='supplier','FORBIDDEN','Недоступно',403);
  return transaction(db=>idempotent(db,actor,'inventory',key,body,async()=>{
    const warehouse=(await db.query('SELECT * FROM warehouses WHERE id=$1 AND organization_id=$2',[body.warehouseId,actor.organizationId])).rows[0];
    requireThat(warehouse,'NOT_FOUND','Склад не найден',404);
    if(body.kind==='transfer') {
      requireThat(body.targetWarehouseId && body.targetWarehouseId!==body.warehouseId,'TARGET_INVALID','Выберите другой склад',400);
      const target=(await db.query('SELECT 1 FROM warehouses WHERE id=$1 AND organization_id=$2',[body.targetWarehouseId,actor.organizationId])).rowCount;
      requireThat(target,'NOT_FOUND','Склад назначения не найден',404);
    }
    // Stable lock order prevents opposite transfers deadlocking.
    const ids=[body.warehouseId,...(body.kind==='transfer'?[body.targetWarehouseId!]:[])].sort();
    const balances=(await db.query('SELECT * FROM inventory_balances WHERE warehouse_id=ANY($1::uuid[]) AND sku_id=$2 ORDER BY warehouse_id FOR UPDATE',[ids,body.skuId])).rows;
    requireThat(balances.length===ids.length,'STOCK_NOT_FOUND','Остаток не зарегистрирован',404);
    const delta=['writeoff','transfer','external-sale'].includes(body.kind)?-body.quantity:body.kind==='verify'?0:body.quantity;
    const balance=balances.find(b=>b.warehouse_id===body.warehouseId)!;
    requireThat(balance.on_hand+delta>=balance.reserved,'INSUFFICIENT_STOCK','Нельзя списать зарезервированный запас');
    await db.query('UPDATE inventory_balances SET on_hand=on_hand+$3,verified_at=now(),version=version+1 WHERE warehouse_id=$1 AND sku_id=$2',[body.warehouseId,body.skuId,delta]);
    const type=body.kind==='transfer'?'InventoryTransferred':body.kind==='external-sale'?'ExternalSaleReported':body.kind==='receive'?'InventoryReceived':body.kind==='verify'?'SourceReconciled':'InventoryAdjusted';
    const event=await emit(db,{type,organizationId:actor.organizationId,aggregateId:body.warehouseId,version:balance.version+1,skuId:body.skuId,warehouseId:body.warehouseId,
      payload:{quantity:body.quantity,on_hand_delta:delta,reserved_delta:0,verified:true,reason:body.reason,unverified_external_sale:body.kind==='external-sale'}});
    if(body.kind==='transfer') {
      await db.query('UPDATE inventory_balances SET on_hand=on_hand+$3,version=version+1 WHERE warehouse_id=$1 AND sku_id=$2',[body.targetWarehouseId,body.skuId,body.quantity]);
      await emit(db,{type:'InventoryTransferred',organizationId:actor.organizationId,aggregateId:body.targetWarehouseId!,version:1,skuId:body.skuId,warehouseId:body.targetWarehouseId,
        payload:{on_hand_delta:body.quantity,reserved_delta:0,transfer_event:event,reason:body.reason}});
    }
    await audit(db,actor,type,body.warehouseId,key,{skuId:body.skuId,quantity:body.quantity,reason:body.reason});
    return {event_id:event};
  }));
}
