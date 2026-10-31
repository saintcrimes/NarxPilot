import { query, pool, assertDatabaseIdentity, type Db } from './db';
import { Decimal, total } from '../domain/money';
import { requireThat } from '../domain/errors';
import type { Snapshot } from '../domain/types';
import { origin } from './config';
export type Product = { id:string; code:string; brand:string; model:string; variant:string; condition:string; region:string; warranty:string; category:string };
export type Offer = {
  id:string; supplier_id:string; supplier_name:string; sku_id:string; warehouse_id:string;
  current_version:number; unit_price:string; delivery:string|null; fees:string;
  min_quantity:number; delivery_days:number; available:number|null; location_id:string;
  location_name:string; warranty:string; valid_until:Date; last_verified_at:Date;
  currency:'UZS'; payment_terms:'bank_transfer'; price_basis:'seller_final';
  total:string|null; eligible:boolean; expired:boolean;
};
export async function products(search='') {
  return query<Product>(`SELECT * FROM skus WHERE concat_ws(' ',code,brand,model,variant,condition,region,warranty) ILIKE $1 ORDER BY code LIMIT 100`,['%'+search+'%']);
}
export async function offers(skuId:string, quantity:number, location='all', db:Db=pool(), includeStale=false) {
  await assertDatabaseIdentity(db);
  const rows = (await db.query(`SELECT o.*,v.*,o.id,s.name supplier_name,k.warranty,v.valid_until<=now() AS expired,
    w.location_id,l.name location_name,
    CASE WHEN b.verified_at > now()-interval '24 hours' THEN b.on_hand-b.reserved ELSE NULL END available
    FROM offers o JOIN offer_versions v ON v.offer_id=o.id AND v.version=o.current_version
    JOIN organizations s ON s.id=o.supplier_id JOIN skus k ON k.id=o.sku_id
    JOIN warehouses w ON w.id=o.warehouse_id JOIN locations l ON l.id=w.location_id
    JOIN inventory_balances b ON b.warehouse_id=o.warehouse_id AND b.sku_id=o.sku_id
    WHERE o.sku_id=$1 AND o.active AND o.data_origin=$2
      AND ($3='all' OR w.location_id=$3) AND ($4 OR v.valid_until>now())`,[skuId,origin(),location,includeStale])).rows;
  return (rows as Offer[]).map(o=>({...o,total:total(o.unit_price,quantity,o.delivery,o.fees),
    eligible:o.available !== null && o.available>=quantity && o.min_quantity<=quantity && !o.expired}))
    .sort((a,b)=>a.total===null?1:b.total===null?-1:new Decimal(a.total).comparedTo(b.total));
}
export function snapshot(offer:Offer, quantity:number):Snapshot {
  requireThat(offer.eligible,'OFFER_UNAVAILABLE','Предложение просрочено, запас не подтверждён или партия недоступна');
  requireThat(offer.delivery!==null && offer.total!==null,'DELIVERY_UNKNOWN','Поставщик должен указать стоимость доставки');
  return { skuId:offer.sku_id,offerId:offer.id,offerVersion:offer.current_version,warehouseId:offer.warehouse_id,
    supplierId:offer.supplier_id,quantity,unitPrice:offer.unit_price,delivery:offer.delivery,fees:offer.fees,total:offer.total,
    currency:'UZS',paymentTerms:'bank_transfer',priceBasis:'seller_final',channel:'B2B',warranty:offer.warranty,
    location:offer.location_id,deliveryDays:offer.delivery_days,capturedAt:new Date().toISOString() };
}
