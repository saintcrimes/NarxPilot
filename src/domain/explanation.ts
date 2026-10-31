import { requireThat } from './errors';
export type MetricMap=Record<string,string|string[]|null>;
export const explanationStatements={
  separate_series:'Цены предложений, цены завершённых сделок и объём продаж — разные ряды.',
  no_causation:'Снижение зарегистрированных продаж само по себе не доказывает снижение цены.',
  sample_scope:'Показатели описывают подключённую выборку, а не весь рынок.',
  quality_required:'Направление цены публикуется только после проверки двух полных окон и качества данных.'
};
export function validateExplanation(value:unknown,metrics:MetricMap) {
  requireThat(value!==null && typeof value==='object' && !Array.isArray(value),'UNTRUSTED_EXPLANATION','Некорректный формат пояснения');
  const v=value as Record<string,unknown>;
  requireThat(Object.keys(v).every(k=>['statement_ids','metric_ids'].includes(k)),'UNTRUSTED_EXPLANATION','Неизвестные поля');
  requireThat(Array.isArray(v.statement_ids)&&v.statement_ids.length>0&&v.statement_ids.length<=4&&v.statement_ids.every(k=>typeof k==='string'&&Object.hasOwn(explanationStatements,k)),'UNTRUSTED_EXPLANATION','Неизвестные утверждения');
  requireThat(Array.isArray(v.metric_ids)&&v.metric_ids.length<=4&&v.metric_ids.every(k=>typeof k==='string'&&Object.hasOwn(metrics,k)),'UNTRUSTED_EXPLANATION','Неизвестные показатели');
  return {summary:(v.statement_ids as (keyof typeof explanationStatements)[]).map(k=>explanationStatements[k]).join(' '),facts:(v.metric_ids as string[]).map(metric_id=>({metric_id,value:metrics[metric_id]}))};
}
