import test from 'node:test';
import assert from 'node:assert/strict';
import {medianRange} from '../../src/components/analytics-market-card';
import type {SeriesPoint} from '../../src/components/charts/series-chart';
const row=(value:string|null):SeriesPoint=>({date:'2026-10-30',complete:true,transaction_price_median:value,transaction_price_vwap:null,offer_price_median:null,units_sold_net:null,available_stock:null,completed_orders_count:null,active_sellers:null,suppressed:false});
test('Диапазон медиан не подменяет пропуски нулём',()=>{
  assert.deepEqual(medianRange([row(null),row(null)]),{high:null,low:null});
  assert.deepEqual(medianRange([row(null),row('26000.25'),row('25500.10')]),{high:'26000.25',low:'25500.10'});
});
test('Диапазон сохраняет денежную точность выше границы JS integer',()=>{
  assert.deepEqual(medianRange([row('9007199254740993.11'),row('9007199254740993.10')]),{high:'9007199254740993.11',low:'9007199254740993.10'});
});
