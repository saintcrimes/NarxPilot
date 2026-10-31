import { parse } from 'csv-parse/sync';
import { offerSchema,uuid } from './validation';
import { requireThat } from '../domain/errors';
import type { Actor } from '../domain/types';
import { query } from './db';
import { updateOffer } from './inventory';
const rowSchema=offerSchema.extend({offerId:uuid});
export async function previewCsv(actor:Actor,text:string) {
  requireThat(actor.role==='supplier','FORBIDDEN','Недоступно',403);
  requireThat(Buffer.byteLength(text)<=32000,'CSV_TOO_LARGE','CSV: максимум 32 КБ',400);
  let raw:Record<string,string>[];
  try {raw=parse(text,{columns:true,skip_empty_lines:true,trim:true,max_record_size:2000,bom:true}) as Record<string,string>[];}
  catch {requireThat(false,'CSV_INVALID','Некорректный CSV',400);}
  requireThat(raw.length>0&&raw.length<=100,'CSV_ROW_LIMIT','От 1 до 100 строк',400);
  const own=new Set((await query('SELECT id FROM offers WHERE supplier_id=$1',[actor.organizationId])).map(o=>o.id));
  const seen=new Set<string>();
  return raw.map((r,i)=>{
    const parsed=rowSchema.safeParse({...r,delivery:r.delivery===''?null:r.delivery,minQuantity:Number(r.minQuantity),deliveryDays:Number(r.deliveryDays)});
    let error=parsed.success?null:'Некорректные поля строки';
    if(parsed.success&&!own.has(parsed.data.offerId)) error='Предложение не принадлежит вашей организации';
    if(parsed.success&&seen.has(parsed.data.offerId)) error='Повтор предложения в одном файле';
    if(parsed.success) seen.add(parsed.data.offerId);
    return {line:i+2,error,data:parsed.success?parsed.data:null};
  });
}
export async function importCsv(actor:Actor,text:string,key:string) {
  const rows=await previewCsv(actor,text);
  requireThat(rows.every(r=>!r.error),'CSV_ERRORS','Исправьте ошибки предварительной проверки',400);
  // Each row has a stable operation key. A retry safely completes a partially interrupted import.
  const result=[];
  for(const row of rows) {const {offerId,...body}=row.data!;result.push(await updateOffer(actor,offerId,body,`${key}_${row.line}`));}
  return {imported:result.length};
}
