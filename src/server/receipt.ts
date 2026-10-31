import { Decimal,median } from '../domain/money';
import type { Actor,Snapshot } from '../domain/types';
import { getOrder } from './orders';
import { offers,type Offer } from './catalog';
import { query } from './db';
import { isDemo } from './config';

type Candidate=Pick<Offer,'supplier_id'|'total'|'eligible'|'currency'|'payment_terms'|'price_basis'|'delivery_days'|'warranty'>;
export function receiptBenchmark(terms:Snapshot,candidates:Candidate[],asOf:string,minimum=5){
  const minSellers=Number.isSafeInteger(minimum)&&minimum>=5?minimum:5;
  const bySupplier=new Map<string,string>();
  for(const candidate of candidates){
    if(!candidate.eligible||candidate.total===null||candidate.currency!==terms.currency||candidate.payment_terms!==terms.paymentTerms||candidate.price_basis!==terms.priceBasis||candidate.delivery_days!==terms.deliveryDays||candidate.warranty!==terms.warranty)continue;
    const current=bySupplier.get(candidate.supplier_id);
    if(current===undefined||new Decimal(candidate.total).lt(current))bySupplier.set(candidate.supplier_id,candidate.total);
  }
  const base={sellers:bySupplier.size,min_sellers:minSellers,basis:'current_comparable_offers' as const,as_of:asOf,threshold_pct:'2.00',limitations:[
    'Сравнение с текущими предложениями платформы, а не со всем рынком и не с историей цен на дату заказа.',
    'Одинаковый SKU, количество, валюта, гарантия, условия оплаты и срок доставки; полная стоимость включает доставку и сборы.',
    'По каждому поставщику взято минимальное доступное предложение по складам; это не подтверждённая цена сделки.'
  ]};
  if(bySupplier.size<minSellers)return {...base,status:'insufficient_data' as const,median_total:null,difference_pct:null};
  const value=median([...bySupplier.values()])!;
  if(new Decimal(value).lte(0))return {...base,status:'insufficient_data' as const,median_total:null,difference_pct:null};
  const difference=new Decimal(terms.total).div(value).minus(1).mul(100);
  return {...base,status:difference.lt(-2)?'below' as const:difference.gt(2)?'above' as const:'typical' as const,median_total:value,difference_pct:difference.toFixed(2)};
}
export async function orderReceipt(actor:Actor,id:string){
  // Ownership is checked before reading labels or current comparison offers.
  const order=await getOrder(actor,id);
  const terms=order.quote??order.snapshot;
  const product=(await query('SELECT id,code,brand,model,variant FROM skus WHERE id=$1',[order.sku_id]))[0];
  const current=await offers(order.sku_id,terms.quantity,'all');
  const issuedAt=new Date().toISOString();
  return {order_id:order.id,status:order.status,created_at:order.created_at,issued_at:issuedAt,demo:isDemo(),document_type:'order_summary' as const,
    product,buyer_name:order.buyer_name,supplier_name:order.supplier_name,terms,
    terms_source:order.accepted_quote_version!==null?'accepted_quote' as const:order.quote?'supplier_quote' as const:'request_snapshot' as const,
    benchmark:receiptBenchmark(terms,current,issuedAt,Number(process.env.MIN_MARKET_SELLERS??5)),
    notice:'Сводка заказа NarxPilot. Не является кассовым или фискальным чеком и не подтверждает оплату. Статус заказа и условия показаны отдельно от текущего сравнения предложений.'};
}
