import { NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes,createHmac } from 'node:crypto';
import { actor,session,demoProfiles,loginDemo,sessionProfile,register,login } from '@/server/auth';
import { registrationSchema,loginSchema } from '@/server/credentials';
import { isDemo,origin } from '@/server/config';
import { chatbotEnabled } from '@/domain/flags';
import { requireThat } from '@/domain/errors';
import { respond,bodyOf,protectMutation,rateLimit } from '@/server/http';
import { query } from '@/server/db';
import { products,offers } from '@/server/catalog';
import { createOrder,listOrders,getOrder,orderAction } from '@/server/orders';
import { analytics } from '@/server/analytics';
import { explain } from '@/server/assistant';
import { chatbotState,productHelp } from '@/server/product-help';
import { supplierDashboard,updateOffer,createOffer,inventoryAction } from '@/server/inventory';
import { previewCsv,importCsv } from '@/server/csv';
import { uuid,quantity,location,positiveAmount,createOrderSchema,orderActionSchema,offerSchema,inventorySchema } from '@/server/validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:NextRequest,context:Context) {
  return respond(async()=>{
    const {path:p}=await context.params; const route=p.join('/'); const search=request.nextUrl.searchParams;
    if(route==='health/live') return {status:'ok'};
    if(route==='health/ready') {
      const identity=(await query('SELECT data_origin FROM database_identity WHERE singleton'))[0];
      requireThat(identity?.data_origin===origin(),'DATABASE_MODE_MISMATCH','Неверная база',503);
      const migrations=(await query('SELECT count(*)::integer n FROM schema_migrations'))[0].n;
      requireThat(migrations>=4,'MIGRATIONS_PENDING','Требуются миграции',503);
      return {status:'ready',data_origin:identity.data_origin};
    }
    if(route==='session') {
      const s=await session(); if(!s.csrf){s.csrf=randomBytes(24).toString('hex');await s.save();}
      const profiles=isDemo()?await demoProfiles():[];
      const profile=await sessionProfile();
      const help=chatbotState();
      return {csrf:s.csrf,demo:isDemo(),chatbot_enabled:chatbotEnabled(process.env.CHATBOT_ENABLED),chatbot_provider:help.provider,chatbot_available:help.available&&Boolean(profile),profiles,profile};
    }
    const a=await actor(); await rateLimit(a.organizationId,600);
    if(route==='products') return products(z.string().max(120).parse(search.get('q')??''));
    if(p[0]==='skus'&&p[2]==='offers') return offers(uuid.parse(p[1]),quantity.parse(Number(search.get('quantity')??5)),location.parse(search.get('location')??'all'),undefined,search.get('includeStale')==='true');
    if(route==='orders') return listOrders(a);
    if(p[0]==='orders'&&p.length===2) return getOrder(a,uuid.parse(p[1]));
    if(p[0]==='analytics'&&p[1]) return analytics(a,uuid.parse(p[1]),z.enum(['platform','own']).parse(search.get('scope')??'platform'),location.parse(search.get('location')??'all'),z.enum(['1','2-9','10+']).parse(search.get('terms')??'2-9'));
    if(route==='supplier') return supplierDashboard(a);
    if(route==='notifications') return query('SELECT * FROM notifications WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',[a.organizationId]);
    if(route==='favorites') return query('SELECT a.*,k.model,k.variant FROM alert_rules a JOIN skus k ON k.id=a.sku_id WHERE a.organization_id=$1',[a.organizationId]);
    if(route==='admin/quality') {
      requireThat(a.role==='admin','FORBIDDEN','Недоступно',403);
      return {outbox:(await query('SELECT count(*)::integer pending,max(attempts) max_attempts,min(available_at) oldest FROM outbox WHERE processed_at IS NULL'))[0],
        events:(await query('SELECT count(*)::integer n FROM business_events'))[0].n,
        snapshots:(await query('SELECT count(*)::integer n,max(as_of) last_calculated FROM analytics_snapshots'))[0]};
    }
    requireThat(false,'NOT_FOUND','Маршрут не найден',404);
  });
}
export async function POST(request:NextRequest,context:Context) {
  return respond(async()=>{
    await protectMutation(request); const {path:p}=await context.params;const route=p.join('/');
    const body=await bodyOf(request);const key=request.headers.get('idempotency-key')??'';
    if(route==='session/demo') {await rateLimit('demo-login',120);return loginDemo(z.object({userId:uuid}).strict().parse(body).userId);}
    if(route==='auth/register'||route==='auth/login'){
      const b=route==='auth/register'?registrationSchema.parse(body):loginSchema.parse(body);
      const s=await session();
      const fingerprint=(value:string)=>createHmac('sha256',process.env.SESSION_SECRET??'').update(value).digest('hex');
      await rateLimit('auth:email:'+fingerprint(b.email),10);
      await rateLimit('auth:session:'+fingerprint(s.csrf??''),20);
      await rateLimit('auth:ip:'+fingerprint(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'direct'),60);
      return route==='auth/register'?register(b):login(b);
    }
    const a=await actor();await rateLimit('mutation:'+a.organizationId,180);
    if(route==='session/logout') {(await session()).destroy();return {ok:true};}
    if(route==='help/chat') {
      requireThat(chatbotEnabled(process.env.CHATBOT_ENABLED),'CHAT_DISABLED','Справка отключена',404);
      await rateLimit('help:'+a.organizationId,10);
      const b=z.object({message:z.string().trim().min(1).max(1000)}).strict().parse(body);
      return productHelp(a,(await session()).csrf??'',b.message);
    }
    if(route==='compare') {const b=z.object({skuId:uuid,quantity,location:location.default('all')}).strict().parse(body);return (await offers(b.skuId,b.quantity,b.location)).filter(o=>o.eligible);}
    if(route==='orders') return createOrder(a,createOrderSchema.parse(body),key);
    if(route==='offers') return createOffer(a,offerSchema.extend({skuId:uuid,warehouseId:uuid}).parse(body),key);
    if(p[0]==='orders'&&p.length===3) return orderAction(a,uuid.parse(p[1]),p[2],orderActionSchema.parse(body),key);
    if(p[0]==='offers'&&p.length===2) return updateOffer(a,uuid.parse(p[1]),offerSchema.parse(body),key);
    if(route==='inventory') return inventoryAction(a,inventorySchema.parse(body),key);
    if(route==='supplier/csv/preview') return previewCsv(a,z.object({csv:z.string().max(32000)}).strict().parse(body).csv);
    if(route==='supplier/csv/import') {requireThat(/^[\w-]{8,90}$/.test(key),'IDEMPOTENCY_KEY_REQUIRED','Нужен ключ импорта',400);return importCsv(a,z.object({csv:z.string().max(32000)}).strict().parse(body).csv,key);}
    if(route==='analytics/explain') {const b=z.object({skuId:uuid,location:location.default('all'),terms:z.enum(['1','2-9','10+']).default('2-9')}).strict().parse(body);return explain(a,b.skuId,b.location,b.terms);}
    if(route==='favorites') {
      const b=z.object({skuId:uuid,location:location.default('all'),threshold:positiveAmount.nullable(),enabled:z.boolean()}).strict().parse(body);
      return (await query(`INSERT INTO alert_rules(organization_id,sku_id,location_id,threshold,enabled) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(organization_id,sku_id,location_id) DO UPDATE SET threshold=excluded.threshold,enabled=excluded.enabled RETURNING *`,[a.organizationId,b.skuId,b.location,b.threshold,b.enabled]))[0];
    }
    if(route==='notifications/read') {const b=z.object({id:uuid}).strict().parse(body);const rows=await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id',[b.id,a.organizationId]);requireThat(rows.length,'NOT_FOUND','Уведомление не найдено',404);return {ok:true};}
    requireThat(false,'NOT_FOUND','Маршрут не найден',404);
  });
}
