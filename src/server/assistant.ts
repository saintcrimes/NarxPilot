import type { Actor } from '../domain/types';
import { analytics } from './analytics';
import { validateExplanation,explanationStatements,type MetricMap } from '../domain/explanation';
type Explanation={provider:string;is_ai:boolean;sku_id:string;cohort:string;snapshot_version:string;summary:string;facts:{metric_id:string;value:string|string[]|null}[];hypotheses:string[];limitations:string[];generated_at:string;data_cutoff:unknown};
const cache=new Map<string,{expires:number;value:Explanation}>();
export async function explain(actor:Actor,skuId:string,location='all',terms='2-9'):Promise<Explanation> {
  // Only public privacy-filtered aggregates. No order tools or supplier text.
  const data=await analytics(actor,skuId,'platform',location,terms);
  const context={sku_id:skuId,cohort:data.cohort,snapshot_version:String(data.version??'pending')};
  const metrics:MetricMap={quality_flags:data.quality_flags,price_trend:data.price_trend??'insufficient_data',price_change_pct:data.price_change_pct??null,sales_change_pct:data.sales_change_pct??null};
  const template=():Explanation=>({provider:'template',is_ai:false,...context,...validateExplanation({statement_ids:['separate_series','no_causation','sample_scope'],metric_ids:['price_trend','quality_flags']},metrics),hypotheses:[],
    limitations:['Шаблонное пояснение по методике, не AI-анализ.','Прогноз и причинные объяснения из объёма продаж не выводятся.'],generated_at:new Date().toISOString(),data_cutoff:data.data_cutoff??null});
  if(process.env.LLM_PROVIDER!=='openai'||!process.env.OPENAI_API_KEY||!process.env.OPENAI_MODEL)return template();
  const key=JSON.stringify([data.data_origin,skuId,data.cohort,context.snapshot_version,process.env.OPENAI_MODEL]);const saved=cache.get(key);
  if(saved&&saved.expires>Date.now())return saved.value;
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_SECONDS??20)*1000),
      body:JSON.stringify({model:process.env.OPENAI_MODEL,store:false,max_output_tokens:500,
        instructions:'Select useful approved explanation statement IDs and metric IDs for this aggregate. Do not calculate or infer causes. Output only the requested JSON. No tools are available.',
        input:JSON.stringify({metrics,approved_statements:explanationStatements}),
        text:{format:{type:'json_schema',name:'analytics_explanation',strict:true,schema:{type:'object',properties:{statement_ids:{type:'array',items:{type:'string',enum:Object.keys(explanationStatements)}},metric_ids:{type:'array',items:{type:'string',enum:Object.keys(metrics)}}},required:['statement_ids','metric_ids'],additionalProperties:false}}}})});
    if(!response.ok)throw new Error('Provider unavailable');
    const result=await response.json() as {status?:string;output?:{type:string;content?:{type:string;text?:string}[]}[]};
    if(result.status!=='completed')throw new Error('Incomplete response');
    const text=result.output?.filter(o=>o.type==='message').flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('')??'';
    if(text.length>5000)throw new Error('Response too large');
    const verified=validateExplanation(JSON.parse(text),metrics);
    const explanation:Explanation={provider:'openai',is_ai:true,...context,...verified,hypotheses:[],limitations:['Модель выбирает проверенные формулировки и ссылки на метрики; числа подставлены сервером.','Это пояснение агрегатов, не прогноз цены.'],generated_at:new Date().toISOString(),data_cutoff:data.data_cutoff??null};
    if(cache.size>=100)cache.clear();cache.set(key,{expires:Date.now()+300000,value:explanation});return explanation;
  } catch {return template();}
}
