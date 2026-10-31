import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptBenchmark } from '../../src/server/receipt';
import type { Snapshot } from '../../src/domain/types';
const terms={skuId:'sku',quantity:5,unitPrice:'18.00',delivery:'5.00',fees:'5.00',total:'100.00',currency:'UZS',paymentTerms:'bank_transfer',priceBasis:'seller_final',deliveryDays:1,warranty:'12 месяцев'} as Snapshot;
const candidate=(id:string,total:string|null,eligible=true)=>({supplier_id:id,total,eligible,currency:'UZS' as const,payment_terms:'bank_transfer' as const,price_basis:'seller_final' as const,delivery_days:1,warranty:terms.warranty});
const at='2026-10-31T09:00:00.000Z';
test('Оценка полной стоимости использует пять независимых поставщиков и Decimal медиану',()=>{
  const rows=['98.00','99.00','100.00','101.00','102.00'].map((value,i)=>candidate(String(i),value));
  const result=receiptBenchmark(terms,[...rows,candidate('0','5000.00')],at);
  assert.equal(result.status,'typical');assert.equal(result.median_total,'100.00');assert.equal(result.difference_pct,'0.00');assert.equal(result.sellers,5);
  assert.equal(receiptBenchmark({...terms,total:'97.99'},rows,at).status,'below');assert.equal(receiptBenchmark({...terms,total:'102.01'},rows,at).status,'above');
  assert.equal(receiptBenchmark({...terms,total:'98.00'},rows,at).status,'typical');assert.equal(receiptBenchmark({...terms,total:'102.00'},rows,at).status,'typical');
});
test('Малая выборка, неизвестная доставка, просроченные и несопоставимые условия не дают оценку',()=>{
  const rows=Array.from({length:4},(_,i)=>candidate(String(i),'100.00'));
  const result=receiptBenchmark(terms,[...rows,candidate('4',null),candidate('5','1.00',false),{...candidate('6','1.00'),delivery_days:2}],at);
  assert.equal(result.status,'insufficient_data');assert.equal(result.median_total,null);assert.equal(result.difference_pct,null);
  assert.equal(receiptBenchmark(terms,rows,at,1).min_sellers,5);
  assert.equal(receiptBenchmark(terms,[...rows,candidate('4','100')],at,6).status,'insufficient_data');
});
