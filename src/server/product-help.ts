import { createHmac } from 'node:crypto';
import { chatbotEnabled } from '../domain/flags';
import { matchQuestion,type HelpAnswer } from '../domain/faq';
import { requireThat } from '../domain/errors';
import type { Actor } from '../domain/types';

// The request contract is supplied by the user in bro24.md. No undocumented fields.
const endpoint='https://dashboard.bro24.uz/api/v1/public/chat';
type Environment=Record<string,string|undefined>;
export type ProductHelpResponse=HelpAnswer&{provider:'local'|'bro24';fallback:boolean};
function responsePath(value:string|undefined):string[]|null {
  if(!value||value.length>160)return null;
  const parts=value.split('.');
  return parts.length<=8&&parts.every(p=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)&&!['__proto__','prototype','constructor'].includes(p))?parts:null;
}
export function chatbotState(env:Environment=process.env) {
  const provider=env.CHATBOT_PROVIDER==='bro24'?'bro24':'local';
  const key=env.BRO24_API_KEY?.trim();
  const configured=provider==='local'||Boolean(key&&!/[\r\n]/.test(key)&&responsePath(env.BRO24_REPLY_JSON_PATH)&&(env.SESSION_SECRET?.length??0)>=32);
  return {provider,available:chatbotEnabled(env.CHATBOT_ENABLED)&&configured} as const;
}
export function externalClientId(actor:Actor,sessionToken:string,env:Environment=process.env):string {
  requireThat((env.SESSION_SECRET?.length??0)>=32&&sessionToken.length>=32,'CHAT_NOT_CONFIGURED','Справка временно работает локально',503);
  return 'np_'+createHmac('sha256',env.SESSION_SECRET!).update(JSON.stringify(['narxpilot-help-v1',env.DEMO_MODE==='true'?'synthetic':'live',actor.organizationId,actor.userId,sessionToken])).digest('hex').slice(0,40);
}
export function extractReply(payload:unknown,path:string):string {
  const parts=responsePath(path);requireThat(parts,'INVALID_CHAT_RESPONSE','Не настроено поле ответа',503);
  let current:unknown=payload;
  for(const part of parts){requireThat(current!==null&&typeof current==='object'&&!Array.isArray(current)&&Object.hasOwn(current,part),'INVALID_CHAT_RESPONSE','Неизвестный формат ответа',503);current=(current as Record<string,unknown>)[part];}
  requireThat(typeof current==='string'&&current.trim().length>0&&current.length<=10000,'INVALID_CHAT_RESPONSE','Некорректный ответ справки',503);
  return current.trim();
}
async function readReply(response:Response,path:string) {
  requireThat(response.ok,'CHAT_PROVIDER_UNAVAILABLE','Внешняя справка недоступна',503);
  requireThat(/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??''),'INVALID_CHAT_RESPONSE','Ожидался JSON',503);
  requireThat(Number(response.headers.get('content-length')??0)<=65536,'INVALID_CHAT_RESPONSE','Слишком большой ответ',503);
  const reader=response.body?.getReader();requireThat(reader,'INVALID_CHAT_RESPONSE','Пустой ответ',503);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new Error('Response limit');}chunks.push(part.value);}
  return extractReply(JSON.parse(Buffer.concat(chunks).toString('utf8')),path);
}
export async function productHelp(actor:Actor,sessionToken:string,message:string,options:{env?:Environment;fetcher?:typeof fetch}={}):Promise<ProductHelpResponse> {
  const env=options.env??process.env;
  requireThat(chatbotEnabled(env.CHATBOT_ENABLED),'CHAT_DISABLED','Справка отключена',404);
  requireThat(typeof message==='string'&&message.trim().length>0&&message.length<=1000,'INVALID_CHAT_MESSAGE','Сообщение: от 1 до 1000 символов',400);
  const local=matchQuestion(message);const state=chatbotState(env);
  // Dynamic business data/actions always stay in normal authorized product screens.
  if(state.provider==='local'||local.id||local.routeOnly)return {...local,provider:'local',fallback:false};
  if(!state.available)return {...local,provider:'local',fallback:true};
  try {
    const configuredTimeout=Number(env.BRO24_TIMEOUT_MS??8000);
    const timeout=Number.isFinite(configuredTimeout)?Math.max(1000,Math.min(20000,configuredTimeout)):8000;
    const response=await (options.fetcher??fetch)(endpoint,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeout),
      headers:{'X-API-Key':env.BRO24_API_KEY!.trim(),'Content-Type':'application/json'},
      body:JSON.stringify({client_id:externalClientId(actor,sessionToken,env),channel:'website',message:message.trim()})});
    const answer=await readReply(response,env.BRO24_REPLY_JSON_PATH!);
    return {provider:'bro24',answer,links:[],fallback:false};
  } catch {
    // Never log chat contents, keys, provider payloads or exception messages.
    return {...local,provider:'local',fallback:true};
  }
}
