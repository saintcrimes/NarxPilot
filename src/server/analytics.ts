import { query } from './db';
import { origin } from './config';
import type { Actor } from '../domain/types';
import { requireThat } from '../domain/errors';
export async function analytics(actor:Actor,skuId:string,scope='platform',location='all',terms='2-9') {
  requireThat(['platform','own'].includes(scope),'INVALID_SCOPE','Неизвестная область данных',400);
  requireThat(scope!=='own'||actor.role==='supplier','FORBIDDEN','Собственная аналитика доступна поставщику',403);
  const internalScope=scope==='own'?`own:${actor.organizationId}`:'platform';
  const cohort=`${location}|${terms}`;
  const row=(await query('SELECT * FROM analytics_snapshots WHERE sku_id=$1 AND scope=$2 AND cohort=$3 AND data_origin=$4',[skuId,internalScope,cohort,origin()]))[0];
  const pending=(await query(`SELECT count(*)::integer n FROM outbox o JOIN business_events e ON e.event_id=o.event_id WHERE e.sku_id=$1 AND o.processed_at IS NULL`,[skuId]))[0].n;
  if(!row) return {scope,cohort,data_origin:origin(),status:'pending',pending_events:pending,series:[],quality_flags:['Снимок ещё не рассчитан'],forecast:{status:'insufficient_data',reason:'Экспериментальная модель не включена'}};
  return {...row.payload,scope,cohort,data_origin:row.data_origin,as_of:row.as_of,data_cutoff:row.data_cutoff,version:row.version,
    pending_events:pending,metric_definitions_version:row.metric_definitions_version};
}
