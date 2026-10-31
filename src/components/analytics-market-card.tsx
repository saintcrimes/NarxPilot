'use client';
import {Decimal} from '../domain/money';
import {formatMoney} from './client';
import {usePreferences} from './preferences';
import type {SeriesPoint} from './charts/series-chart';

type Props={rows:SeriesPoint[];unit:string;priceChangePct:string|null};
/** Range of observed daily transaction medians, never an individual-sale high/low. */
export function medianRange(rows:SeriesPoint[]){
  const values=rows.flatMap(row=>{if(row.transaction_price_median===null)return [];try{const value=new Decimal(row.transaction_price_median);return value.isFinite()?[value]:[];}catch{return [];}});
  return values.length?{high:Decimal.max(...values).toFixed(2),low:Decimal.min(...values).toFixed(2)}:{high:null,low:null};
}
export function AnalyticsMarketCard({rows,unit,priceChangePct}:Props){
  const {t}=usePreferences();const latest=rows.at(-1);
  const observed=[...rows].reverse().find(row=>row.transaction_price_median!==null);const range=medianRange(rows);
  let change:Decimal|null=null;try{if(priceChangePct!==null){const candidate=new Decimal(priceChangePct);if(candidate.isFinite())change=candidate;}}catch{}
  const direction=change===null?'unknown':change.isZero()?'flat':change.gt(0)?'up':'down';
  return <div className="analytics-market-card">
    <div className="analytics-market-headline">
      <div><p className="analytics-market-label">{t('Последняя медиана сделок')}</p><div className="analytics-market-price">{formatMoney(observed?.transaction_price_median)}<span>UZS/{t(unit)}</span></div><p className="analytics-market-observed">{t('Наблюдение цены')}: {observed?.date??t('нет данных')}</p></div>
      <div className="analytics-market-trend"><span className={'analytics-trend-pill trend-'+direction}>{change===null?'—':<><span aria-hidden="true">{direction==='up'?'↗':direction==='down'?'↘':'→'}</span> {change.gt(0)?'+':''}{change.toFixed(2)}%</>}</span><span>{t('Два полных окна по 7 дней')}</span></div>
    </div>
    <div className="analytics-market-metrics">
      <div className="analytics-market-volume"><span>{t('Нетто-продажи последнего дня')}</span><strong>{latest?.units_sold_net??t('нет данных')} <small>{t(unit)}</small></strong><small>{latest?.date??'—'}{latest&&!latest.complete?' · '+t('Неполный день'):''}</small></div>
      <div className="analytics-market-range" aria-label={t('Диапазон дневных медиан за выбранный период')}>
        <div><span title={t('Максимальная дневная медиана подтверждённых сделок')}>{t('Макс. медиана')}</span><strong>{formatMoney(range.high)} <small>UZS</small></strong></div>
        <div><span title={t('Минимальная дневная медиана подтверждённых сделок')}>{t('Мин. медиана')}</span><strong>{formatMoney(range.low)} <small>UZS</small></strong></div>
        <div><span>{t('Наблюдаемых дней')}</span><strong>{rows.filter(row=>row.transaction_price_median!==null).length} <small>/ {rows.length}</small></strong></div>
      </div>
    </div>
  </div>;
}
