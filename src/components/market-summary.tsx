'use client';
import {motion,useReducedMotion} from 'motion/react';
import {usePreferences} from './preferences';
import {formatMoney,dateTime} from './client';
import {ChartLine} from './ui/chart-line';
import type {SeriesPoint} from './charts/series-chart';

type Props={rows:SeriesPoint[];model:string;variant:string;unit:string;source?:string;asOf?:string};
export function MarketSummary({rows,model,variant,unit,source,asOf}:Props){
  const {t,theme}=usePreferences();const reduced=useReducedMotion();
  const observed=[...rows].reverse().find(row=>row.transaction_price_median!==null);
  const latest=rows.at(-1);const hasPrices=rows.some(row=>row.transaction_price_median!==null);
  const motionOn=!reduced;const accent=theme==='light'?'#7941ad':'#cba1ff';
  return <motion.section className="market-summary panel" aria-label={t('Динамика выбранного продукта')}
    initial={motionOn?{opacity:0,y:18}:false} animate={{opacity:1,y:0}} transition={{duration:.6}}
    style={{position:'relative',overflow:'hidden',padding:24,borderColor:theme==='light'?'#d9bde9':'#644179',background:theme==='light'?'linear-gradient(125deg,#fbf7ff,#eee4f8)':'linear-gradient(125deg,#322043,#191c32)'}}>
    <motion.div aria-hidden="true" initial={false} animate={motionOn?{x:[-35,25,-35],y:[15,-15,15],opacity:[.22,.4,.22]}:{opacity:.18}}
      transition={{duration:9,repeat:Infinity,ease:'easeInOut'}} style={{position:'absolute',width:260,height:260,right:-60,top:-150,borderRadius:'50%',background:'#aa5af4',filter:'blur(60px)',pointerEvents:'none'}}/>
    <div style={{position:'relative',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,270px),1fr))',gap:24,alignItems:'center'}}>
      <div>
        <div style={{display:'flex',alignItems:'center',gap:15,marginBottom:17}}>
          <div aria-hidden="true" style={{position:'relative',width:62,height:62,flex:'0 0 62px'}}>
            <motion.svg width="62" height="62" viewBox="0 0 62 62" initial={false} animate={motionOn?{rotate:360}:{rotate:0}} transition={{duration:22,repeat:Infinity,ease:'linear'}} style={{position:'absolute',inset:0}}>
              <circle cx="31" cy="31" r="28" fill="none" stroke={accent} strokeWidth="1" strokeDasharray="4 5" opacity=".65"/><circle cx="31" cy="3" r="3" fill={accent}/>
            </motion.svg>
            <motion.svg width="62" height="62" viewBox="0 0 62 62" initial={false} animate={motionOn?{y:[0,-3,0]}:{y:0}} transition={{duration:3.8,repeat:Infinity,ease:'easeInOut'}} style={{position:'absolute',inset:0}}>
              <path d="M31 44V21m0 12c-8 0-12-5-12-11 7 0 12 4 12 11Zm0 7c8 0 12-5 12-11-7 0-12 4-12 11Z" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </motion.svg>
          </div>
          <div><p className="eyebrow" style={{color:accent,marginBottom:6}}>{t('Динамика выбранного продукта')}</p><h2 style={{fontSize:21,lineHeight:1.25}}>{t(model)}</h2><p className="small muted">{t(variant)} · {t(unit)}</p></div>
        </div>
        <p className="small muted">{t('Цена подтверждённых сделок')}</p>
        <motion.div key={observed?.transaction_price_median??'missing'} initial={motionOn?{opacity:0,y:8}:false} animate={{opacity:1,y:0}} transition={{duration:.45}} style={{fontSize:'clamp(26px,4vw,38px)',fontWeight:750,letterSpacing:'-1px',margin:'5px 0'}}>{formatMoney(observed?.transaction_price_median)} <small style={{fontSize:13,fontWeight:500,letterSpacing:0}}>UZS/{t(unit)}</small></motion.div>
        <p className="small muted">{t('Наблюдение цены')}: {observed?.date??t('Нет пригодных сделок')}</p>
      </div>
      <div style={{minWidth:0}}>
        {hasPrices?<ChartLine data={rows.map(row=>({date:row.date,confirmed:row.transaction_price_median}))} index="date" series={[{key:'confirmed',label:t('Медиана сделок'),color:accent}]} curve="linear" fill="dots" height={150} showXAxis={false} showYAxis={false} showGrid={false} showLegend={false} showPoints="last" total="none" bare animate={motionOn} duration={1.4} valueFormat={value=>formatMoney(value)} title={undefined}/>:<div style={{height:150,display:'grid',placeItems:'center',border:'1px dashed var(--line)',borderRadius:14,color:'var(--muted)'}}>{t('Нет подтверждённых сделок')}</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12,marginTop:6}}>
          {[{label:'Нетто-продажи последнего дня',value:latest?.units_sold_net},{label:'Остаток последнего дня',value:latest?.available_stock}].map((metric,index)=><motion.div key={metric.label} initial={motionOn?{opacity:0,y:12}:false} animate={{opacity:1,y:0}} transition={{duration:.45,delay:.2+index*.13}} style={{background:theme==='light'?'#ffffffb3':'#13132266',border:'1px solid var(--line)',borderRadius:11,padding:'12px 13px'}}><p className="small muted" style={{lineHeight:1.35}}>{t(metric.label)}</p><strong style={{display:'block',fontSize:20,marginTop:6}}>{metric.value??t('нет данных')} <small style={{fontSize:10,fontWeight:400}}>{t(unit)}</small></strong></motion.div>)}
        </div>
      </div>
    </div>
    <div style={{position:'relative',display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:7,borderTop:'1px solid var(--line)',paddingTop:14,marginTop:20,fontSize:10,color:'var(--muted)'}}>
      <span>{t('Источник — события базы')} · {source??t('Ожидается расчёт')}</span><span>{latest?.date??'—'} · {latest?.complete?t('Полный день'):t('Неполный день')} · {dateTime(asOf)}</span>
    </div>
  </motion.section>;
}
