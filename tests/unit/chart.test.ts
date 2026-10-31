import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalValue,formatChartValue,splitChartPoints,chartDomain} from '../../src/components/ui/chart-line-utils/chart-kit';
test('График сохраняет ноль, пропуски и точность денежных строк',()=>{
  for(const value of [null,undefined,'',Infinity,'NaN'])assert.equal(decimalValue(value),null);
  assert.equal(decimalValue('0')?.toString(),'0');
  assert.equal(formatChartValue('9007199254740993.01','currency','UZS',2),'9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,01 UZS');
});
test('Пропуск разделяет линии; полностью отсутствующий ряд не получает нулевой домен',()=>{
  const a={x:0,y:10,row:0,value:'100'},b={x:20,y:20,row:2,value:'90'};
  assert.deepEqual(splitChartPoints([a,null,b]),[[a],[b]]);assert.equal(chartDomain([null,undefined]),null);
  const domain=chartDomain(['0','0']);assert.ok(domain&&domain.range.gt(0));
});
