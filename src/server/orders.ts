import { transaction, query, type Db } from './db';
import { requireThat } from '../domain/errors';
import { Decimal, money, total } from '../domain/money';
import type { Actor, OrderStatus, Snapshot } from '../domain/types';
import { offers, snapshot } from './catalog';
import { idempotent } from './idempotency';
import { emit, audit, notify } from './events';
import { origin, reservationMinutes } from './config';
export type Order = {
  id:string; buyer_id:string; supplier_id:string; sku_id:string; warehouse_id:string;
  offer_id:string; status:OrderStatus; quantity:number; snapshot:Snapshot;
  baseline_snapshot:Snapshot|null; quote:Snapshot|null; quote_version:number;
  quote_expires_at:Date|null; accepted_quote_version:number|null; version:number;
  created_at:Date; updated_at:Date;
};
export function canRead(actor:Actor,order:Order) {
  return (actor.role==='buyer' && order.buyer_id===actor.organizationId) || (actor.role==='supplier' && order.supplier_id===actor.organizationId);
}
async function ownedOrder(db:Db,actor:Actor,id:string,lock=false):Promise<Order> {
  const order=(await db.query(`SELECT * FROM orders WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0] as Order|undefined;
  requireThat(order && canRead(actor,order),'NOT_FOUND','Заказ не найден',404);
  return order;
}
export async function getOrder(actor:Actor,id:string) {
  return transaction(async db=>{
    const order=await ownedOrder(db,actor,id);
    const events=(await db.query('SELECT event_id,type,occurred_at,payload FROM business_events WHERE aggregate_id=$1 ORDER BY recorded_at,event_id',[id])).rows;
    const returns=(await db.query('SELECT id,quantity,resalable,reason,status,created_at,accepted_at FROM returns WHERE order_id=$1 ORDER BY created_at',[id])).rows;
    const reservation=(await db.query('SELECT status,expires_at FROM reservations WHERE order_id=$1',[id])).rows[0]??null;
    const labels=(await db.query(`SELECT concat(k.brand,' ',k.model,' · ',k.variant) product_name,s.name supplier_name,b.name buyer_name
      FROM skus k JOIN organizations s ON s.id=$2 JOIN organizations b ON b.id=$3 WHERE k.id=$1`,[order.sku_id,order.supplier_id,order.buyer_id])).rows[0];
    const baseline=order.baseline_snapshot;
    const savings=baseline && order.quote ? money(new Decimal(baseline.total).minus(order.quote.total)):null;
    return {...order,...labels,events,returns,reservation,expected_savings:savings,
      actual_savings:order.status==='COMPLETED' && returns.length===0?savings:null};
  });
}
export async function listOrders(actor:Actor) {
  if(actor.role==='admin') return [];
  return query<Order & {model:string;variant:string;supplier_name:string;buyer_name:string}>(`SELECT o.*,k.model,k.variant,s.name supplier_name,b.name buyer_name FROM orders o
    JOIN skus k ON k.id=o.sku_id JOIN organizations s ON s.id=o.supplier_id JOIN organizations b ON b.id=o.buyer_id
    WHERE ${actor.role==='buyer'?'o.buyer_id':'o.supplier_id'}=$1 ORDER BY o.created_at DESC LIMIT 100`,[actor.organizationId]);
}
export async function createOrder(actor:Actor,body:{skuId:string;offerId:string;quantity:number;baselineOfferId?:string},key:string) {
  requireThat(actor.role==='buyer','FORBIDDEN','Заявки создаёт покупатель',403);
  return transaction(db=>idempotent(db,actor,'create-order',key,body,async()=>{
    const available=await offers(body.skuId,body.quantity,'all',db);
    const selected=available.find(o=>o.id===body.offerId);
    requireThat(selected,'OFFER_NOT_FOUND','Актуальное предложение не найдено',404);
    const saved=snapshot(selected,body.quantity);
    let baseline:Snapshot|null=null;
    if(body.baselineOfferId) {
      const alternative=available.find(o=>o.id===body.baselineOfferId && o.id!==selected.id);
      requireThat(alternative,'BASELINE_INVALID','Сопоставимая альтернатива не найдена');
      baseline=snapshot(alternative,body.quantity);
      requireThat(baseline.deliveryDays===saved.deliveryDays,'BASELINE_INVALID','Для расчёта экономии нужен одинаковый срок доставки');
    }
    const order=(await db.query(`INSERT INTO orders(buyer_id,supplier_id,sku_id,warehouse_id,offer_id,status,quantity,snapshot,baseline_snapshot,data_origin)
      VALUES($1,$2,$3,$4,$5,'REQUESTED',$6,$7,$8,$9) RETURNING *`,[actor.organizationId,selected.supplier_id,body.skuId,selected.warehouse_id,body.offerId,body.quantity,saved,baseline,origin()])).rows[0] as Order;
    await emit(db,{type:'OrderRequested',organizationId:actor.organizationId,aggregateId:order.id,version:1,skuId:order.sku_id,payload:{quantity:order.quantity}});
    await audit(db,actor,'OrderRequested',order.id,key);
    await notify(db,order.supplier_id,`requested:${order.id}`,'Новая заявка',`Покупатель запросил ${order.quantity} шт.`,order.id);
    return order;
  }));
}
export type ActionBody={quoteVersion?:number;unitPrice?:string;delivery?:string;fees?:string;reason?:string;returnId?:string;quantity?:number;resalable?:boolean};
export async function orderAction(actor:Actor,id:string,action:string,body:ActionBody,key:string) {
  return transaction(db=>idempotent(db,actor,`${action}:${id}`,key,body,async()=>{
    const o=await ownedOrder(db,actor,id,true);
    const buyer=['accept','receive','dispute','return-request'].includes(action);
    const supplier=['quote','ship','reject','return-accept'].includes(action);
    requireThat((!buyer || actor.role==='buyer') && (!supplier || actor.role==='supplier'),'FORBIDDEN','Действие недоступно вашей роли',403);
    let eventType=''; let payload:Record<string,unknown>={};
    let status=o.status;
    if(action==='quote') {
      requireThat(['REQUESTED','QUOTED'].includes(o.status),'INVALID_STATE','Нельзя изменить согласованный заказ');
      requireThat(body.unitPrice && body.delivery!==undefined,'INVALID_QUOTE','Укажите цену и доставку',400);
      const quote:Snapshot={...o.snapshot,unitPrice:money(body.unitPrice),delivery:money(body.delivery),fees:money(body.fees??'0'),
        total:total(body.unitPrice,o.quantity,body.delivery,body.fees??'0')!,capturedAt:new Date().toISOString()};
      await db.query(`UPDATE orders SET quote=$2,quote_version=quote_version+1,quote_expires_at=now()+interval '30 minutes' WHERE id=$1`,[id,quote]);
      status='QUOTED'; eventType='QuoteIssued'; payload={quoteVersion:o.quote_version+1,...quote};
    } else if(action==='accept') {
      requireThat(o.status==='QUOTED' && o.quote,'INVALID_STATE','Нужна действующая котировка');
      requireThat(o.quote_version===body.quoteVersion,'QUOTE_CHANGED','Условия изменились. Ознакомьтесь с новой котировкой');
      const valid=(await db.query('SELECT quote_expires_at>now() AS valid FROM orders WHERE id=$1',[id])).rows[0];
      requireThat(valid.valid,'QUOTE_EXPIRED','Котировка истекла. Запросите подтверждение поставщика');
      const stock=await db.query(`UPDATE inventory_balances SET reserved=reserved+$3,version=version+1
        WHERE warehouse_id=$1 AND sku_id=$2 AND on_hand-reserved >= $3 AND verified_at>now()-interval '24 hours' RETURNING *`,[o.warehouse_id,o.sku_id,o.quantity]);
      requireThat(stock.rowCount,'INSUFFICIENT_STOCK','Не хватает подтверждённого свободного остатка');
      await db.query(`INSERT INTO reservations(order_id,warehouse_id,sku_id,quantity,status,expires_at) VALUES($1,$2,$3,$4,'active',now()+$5*interval '1 minute')`,[id,o.warehouse_id,o.sku_id,o.quantity,reservationMinutes()]);
      await db.query('UPDATE orders SET accepted_quote_version=quote_version WHERE id=$1',[id]);
      await emit(db,{type:'QuoteAccepted',organizationId:actor.organizationId,aggregateId:id,version:o.version+1,skuId:o.sku_id,payload:{quoteVersion:o.quote_version}});
      status='RESERVED'; eventType='StockReserved'; payload={quantity:o.quantity,reserved_delta:o.quantity,on_hand_delta:0};
    } else if(action==='ship') {
      requireThat(o.status==='RESERVED','INVALID_STATE','Отгрузить можно только зарезервированный заказ');
      const reservation=(await db.query("SELECT * FROM reservations WHERE order_id=$1 AND status='active' AND expires_at>now() FOR UPDATE",[id])).rows[0];
      requireThat(reservation,'RESERVATION_EXPIRED','Резерв истёк');
      await db.query('UPDATE inventory_balances SET on_hand=on_hand-$3,reserved=reserved-$3,version=version+1 WHERE warehouse_id=$1 AND sku_id=$2',[o.warehouse_id,o.sku_id,o.quantity]);
      await db.query("UPDATE reservations SET status='consumed' WHERE order_id=$1",[id]);
      await db.query('INSERT INTO shipments(order_id,quantity,actor_id) VALUES($1,$2,$3)',[id,o.quantity,actor.userId]);
      status='SHIPPED'; eventType='OrderShipped'; payload={quantity:o.quantity,on_hand_delta:-o.quantity,reserved_delta:-o.quantity};
    } else if(action==='receive') {
      requireThat(o.status==='SHIPPED' && o.quote,'INVALID_STATE','Приёмка доступна после отгрузки');
      await db.query('INSERT INTO receipts(order_id,quantity,actor_id) VALUES($1,$2,$3)',[id,o.quantity,actor.userId]);
      status='COMPLETED'; eventType='ReceiptAccepted'; payload={quantity:o.quantity,unit_price:o.quote.unitPrice,
        order_id:id,supplier_id:o.supplier_id,location:o.quote.location,terms_group:quantityGroup(o.quantity),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final'};
    } else if(action==='cancel' || action==='reject') {
      requireThat(['REQUESTED','QUOTED','RESERVED'].includes(o.status),'INVALID_STATE','Отмена после отгрузки невозможна');
      requireThat(action!=='reject' || o.status!=='RESERVED','INVALID_STATE','Используйте отмену резерва');
      if(o.status==='RESERVED') {
        await db.query('UPDATE inventory_balances SET reserved=reserved-$3,version=version+1 WHERE warehouse_id=$1 AND sku_id=$2',[o.warehouse_id,o.sku_id,o.quantity]);
        await db.query("UPDATE reservations SET status='released' WHERE order_id=$1",[id]);
        await emit(db,{type:'ReservationReleased',organizationId:actor.organizationId,aggregateId:id,version:o.version+1,skuId:o.sku_id,warehouseId:o.warehouse_id,payload:{quantity:o.quantity,reserved_delta:-o.quantity,on_hand_delta:0}});
      }
      status=action==='reject'?'REJECTED':'CANCELLED'; eventType=action==='reject'?'OrderRejected':'OrderCancelled'; payload={reason:body.reason??'Отмена участником'};
    } else if(action==='dispute') {
      requireThat(o.status==='SHIPPED','INVALID_STATE','Спор открывается до подтверждения приёмки');
      requireThat(body.reason,'REASON_REQUIRED','Укажите причину',400);
      status='DISPUTED';eventType='OrderDisputed';payload={reason:body.reason};
    } else if(action==='return-request') {
      requireThat(o.status==='COMPLETED','INVALID_STATE','Возврат возможен после приёмки');
      requireThat(body.quantity && body.reason && body.resalable!==undefined,'RETURN_INVALID','Укажите количество, состояние и причину',400);
      const pending=(await db.query('SELECT coalesce(sum(quantity),0)::integer n FROM returns WHERE order_id=$1',[id])).rows[0].n as number;
      requireThat(pending+body.quantity<=o.quantity,'RETURN_EXCEEDS_RECEIPT','Нельзя вернуть больше принятого количества');
      const ret=(await db.query('INSERT INTO returns(order_id,quantity,resalable,reason,requested_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,body.quantity,body.resalable,body.reason,actor.userId])).rows[0];
      eventType='ReturnRequested';payload={return_id:ret.id,quantity:body.quantity,reason:body.reason};
    } else if(action==='return-accept') {
      requireThat(o.status==='COMPLETED','INVALID_STATE','Заказ не завершён');
      const ret=(await db.query("SELECT * FROM returns WHERE id=$1 AND order_id=$2 AND status='REQUESTED' FOR UPDATE",[body.returnId,id])).rows[0];
      requireThat(ret,'RETURN_NOT_FOUND','Ожидающий возврат не найден',404);
      await db.query("UPDATE returns SET status='ACCEPTED',accepted_at=now(),accepted_by=$2 WHERE id=$1",[ret.id,actor.userId]);
      await db.query(`UPDATE inventory_balances SET on_hand=on_hand+$3,quarantine=quarantine+$4,version=version+1 WHERE warehouse_id=$1 AND sku_id=$2`,[o.warehouse_id,o.sku_id,ret.resalable?ret.quantity:0,ret.resalable?0:ret.quantity]);
      eventType='ReturnAccepted';payload={return_id:ret.id,order_id:id,quantity:ret.quantity,resalable:ret.resalable,on_hand_delta:ret.resalable?ret.quantity:0,reserved_delta:0};
    } else { requireThat(false,'UNKNOWN_ACTION','Неизвестное действие',404); }
    const updated=(await db.query('UPDATE orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,status])).rows[0] as Order;
    const event=await emit(db,{type:eventType,organizationId:actor.organizationId,aggregateId:id,version:updated.version,skuId:o.sku_id,warehouseId:o.warehouse_id,payload});
    await audit(db,actor,eventType,id,key);
    await notify(db,actor.organizationId===o.buyer_id?o.supplier_id:o.buyer_id,event,'Заказ обновлён',status,id);
    return updated;
  }));
}
export function quantityGroup(quantity:number) { return quantity===1?'1':quantity<10?'2-9':'10+'; }
