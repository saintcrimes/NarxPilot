'use client';
import { Decimal } from '../../domain/money';
import { formatMoney } from '../client';
import { Empty } from '../ui';
export type SeriesPoint={date:string;complete:boolean;transaction_price_median:string|null;transaction_price_vwap:string|null;offer_price_median:string|null;units_sold_net:number|null;available_stock:number|null;completed_orders_count:number|null;active_sellers:number|null;suppressed:boolean};
type Key='transaction_price_median'|'offer_price_median'|'units_sold_net'|'available_stock';
export function SeriesChart({rows,keys,unit}:{rows:SeriesPoint[];keys:{key:Key;label:string;color:string}[];unit:string}) {
  const values=rows.flatMap(row=>keys.map(k=>row[k.key]).filter(v=>v!==null).map(v=>new Decimal(v!)));
  if(!values.length)return <Empty title="Нет доступных наблюдений" description="Отсутствующие данные и малые группы не заменяются нулём."/>;
  const min=Decimal.min(...values);const max=Decimal.max(...values);const margin=max.minus(min).eq(0)?max.mul('.02').plus(1):max.minus(min).mul('.15');
  const low=Decimal.max(0,min.minus(margin));const high=max.plus(margin);const range=high.minus(low);
  const x=(i:number)=>110+(i/(Math.max(1,rows.length-1)))*870;
  // Number применяется только к координатам SVG, после точных Decimal-вычислений.
  const y=(value:string|number)=>230-new Decimal(value).minus(low).div(range).mul(200).toNumber();
  return <div className="chart-wrap"><div className="chart-legend">{keys.map(k=><span key={k.key}><i style={{background:k.color}}/>{k.label}</span>)}<small>{unit}</small></div>
    <svg className="series-chart" viewBox="0 0 1000 280" role="img" aria-label={keys.map(k=>k.label).join(', ')+'. Подробные значения в таблице ниже.'}>
      {[0,1,2,3,4].map(t=>{const value=low.plus(range.mul(t).div(4));const yy=y(value.toString());return <g key={t}><line x1="110" x2="980" y1={yy} y2={yy} stroke="var(--line)" strokeDasharray="3 4"/><text x="96" y={yy+4} textAnchor="end">{unit==='UZS'?formatMoney(value.toFixed(0)):value.toFixed(0)}</text></g>;})}
      {keys.map(k=>{let gap=true;const path=rows.map((r,i)=>{const v=r[k.key];if(v===null){gap=true;return '';}const part=`${gap?'M':'L'} ${x(i)} ${y(v)}`;gap=false;return part;}).join(' ');return <g key={k.key}><path d={path} stroke={k.color} fill="none" strokeWidth="2.5"/>{rows.map((r,i)=>r[k.key]!==null&&(rows.length<32||i===rows.length-1)?<circle key={r.date} cx={x(i)} cy={y(r[k.key]!)} r="3" fill={k.color}><title>{r.date}: {r[k.key]} {unit}</title></circle>:null)}</g>;})}
      {[0,Math.floor((rows.length-1)/2),rows.length-1].map((i,n)=><text key={n} x={x(i)} y="265" textAnchor={n===0?'start':n===2?'end':'middle'}>{rows[i]?.date}</text>)}
    </svg><p className="chart-caption">Разрыв линии — нет пригодного наблюдения. Сегодня — неполный день. Время: Asia/Tashkent.</p></div>;
}
