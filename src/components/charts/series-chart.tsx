'use client';
import { formatMoney } from '../client';
import { Empty } from '../ui';
import { ChartLine } from '../ui/chart-line';
import {usePreferences} from '../preferences';
export type SeriesPoint={date:string;complete:boolean;transaction_price_median:string|null;transaction_price_vwap:string|null;offer_price_median:string|null;units_sold_net:number|null;available_stock:number|null;completed_orders_count:number|null;active_sellers:number|null;suppressed:boolean};
type Key='transaction_price_median'|'offer_price_median'|'units_sold_net'|'available_stock';
export function SeriesChart({rows,keys,unit}:{rows:SeriesPoint[];keys:{key:Key;label:string;color:string}[];unit:string}) {
  const {t}=usePreferences();
  // Only project database fields: keep exact monetary strings, zeroes and gaps intact.
  const data=rows.map(row=>({date:row.date,...Object.fromEntries(keys.map(series=>[series.key,row[series.key]]))}));
  const hasObservations=rows.some(row=>keys.some(series=>row[series.key]!=null));
  return <div className="chart-wrap"><div className="chart-legend" aria-label={t('Ряды графика')}>{keys.map(series=><span key={series.key}><i aria-hidden="true" style={{background:series.color}}/>{series.label}</span>)}<small>{unit}</small></div>
    {hasObservations?<div className="series-chart" role="group" aria-label={keys.map(series=>series.label).join(', ')+'. '+t('Подробные значения в таблице агрегатов ниже.')}>
      <ChartLine data={data} index="date" series={keys} curve="linear" fill="dots" showPoints="last" showLegend height={260} total="none"
        valueFormat={value=>unit==='UZS'?formatMoney(value):value}/>
    </div>:<Empty title={t('Нет доступных наблюдений')} description={t('Отсутствующие данные и малые группы не заменяются нулём.')}/>}
    <p className="chart-caption">{t('Источник — сохранённые агрегаты событий базы. Разрыв линии — нет пригодного наблюдения. Сегодня — неполный день. Время: Asia/Tashkent.')}</p></div>;
}
