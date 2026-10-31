import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatbotState,externalClientId,extractReply,productHelp } from '../../src/server/product-help';
import { faqItems,matchQuestion } from '../../src/domain/faq';
import type { Actor } from '../../src/domain/types';

const actor:Actor={userId:'test-user-private',organizationId:'test-organization-private',role:'buyer'};
const sessionToken='test-session-token-not-a-real-secret-12345';
const unknownQuestion='Какие языки интерфейса поддерживает NarxPilot?';
const fakeKey='fake-test-api-key-never-use-outside-tests';
const configured=():Record<string,string|undefined>=>({CHATBOT_ENABLED:'true',CHATBOT_PROVIDER:'bro24',BRO24_API_KEY:fakeKey,BRO24_REPLY_JSON_PATH:'payload.answer',SESSION_SECRET:'fake-test-session-secret-at-least-32-characters',DEMO_MODE:'true'});
const jsonReply=(value:unknown={payload:{answer:'Ответ о продукте'}})=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8'}});
function spy(handler:()=>Response|Promise<Response>=()=>jsonReply()) {
  const calls:{input:Parameters<typeof fetch>[0];init:RequestInit|undefined}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{calls.push({input,init});return handler();};
  return {calls,fetcher};
}

test('F09: запрос Bro24 использует только документированный endpoint, поля и серверный ключ',async()=>{
  const stub=spy();const env=configured();
  const result=await productHelp(actor,sessionToken,'  '+unknownQuestion+'  ',{env,fetcher:stub.fetcher});
  assert.equal(stub.calls.length,1);
  const {input,init}=stub.calls[0];
  assert.ok(init);
  assert.equal(input,'https://dashboard.bro24.uz/api/v1/public/chat');
  assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  const headers=new Headers(init?.headers);
  assert.deepEqual([...headers.keys()].sort(),['content-type','x-api-key']);
  assert.equal(headers.get('x-api-key'),fakeKey);assert.equal(headers.get('content-type'),'application/json');
  assert.ok(init?.signal instanceof AbortSignal);
  assert.equal(typeof init?.body,'string');
  const body=JSON.parse(init.body as string);
  assert.deepEqual(Object.keys(body).sort(),['channel','client_id','message']);
  assert.equal(body.channel,'website');assert.equal(body.message,unknownQuestion);
  assert.equal(body.client_id,externalClientId(actor,sessionToken,env));
  for(const sensitive of [fakeKey,actor.userId,actor.organizationId,sessionToken,env.SESSION_SECRET!]){
    assert.ok(!(init.body as string).includes(sensitive));assert.ok(!JSON.stringify(result).includes(sensitive));
  }
  assert.deepEqual(result,{provider:'bro24',answer:'Ответ о продукте',links:[],fallback:false});
});

test('F10: client_id непрозрачен и изолирован по организации, пользователю, сессии и происхождению',()=>{
  const env=configured();const base=externalClientId(actor,sessionToken,env);
  assert.match(base,/^np_[a-f0-9]{40}$/);assert.equal(externalClientId(actor,sessionToken,env),base);
  const identifiers=[
    base,
    externalClientId({...actor,organizationId:'another-organization'},sessionToken,env),
    externalClientId({...actor,userId:'another-user'},sessionToken,env),
    externalClientId(actor,sessionToken+'-next-session',env),
    externalClientId(actor,sessionToken,{...env,DEMO_MODE:'false'}),
    externalClientId(actor,sessionToken,{...env,SESSION_SECRET:env.SESSION_SECRET+'-rotated'})
  ];
  assert.equal(new Set(identifiers).size,identifiers.length);
  assert.throws(()=>externalClientId(actor,'short',env));
  assert.throws(()=>externalClientId(actor,sessionToken,{...env,SESSION_SECRET:'short'}));
});

test('F11: выключенный чат не вызывает провайдера и возвращает явную доменную ошибку',async()=>{
  for(const flag of [undefined,'false','TRUE','1','']){
    const env={...configured(),CHATBOT_ENABLED:flag};const stub=spy();
    assert.equal(chatbotState(env).available,false);
    await assert.rejects(productHelp(actor,sessionToken,unknownQuestion,{env,fetcher:stub.fetcher}),{code:'CHAT_DISABLED',status:404});
    assert.equal(stub.calls.length,0);
  }
});

test('F12: неполная конфигурация даёт локальный fallback без внешнего запроса',async()=>{
  const variants:Record<string,string|undefined>[]=[
    {BRO24_API_KEY:undefined},{BRO24_API_KEY:'   '},{BRO24_API_KEY:'bad\nheader'},
    {BRO24_REPLY_JSON_PATH:undefined},{BRO24_REPLY_JSON_PATH:''},{BRO24_REPLY_JSON_PATH:'payload.__proto__'},
    {SESSION_SECRET:undefined},{SESSION_SECRET:'short'}
  ];
  for(const change of variants){
    const env={...configured(),...change};const stub=spy();
    assert.equal(chatbotState(env).available,false);
    const result=await productHelp(actor,sessionToken,unknownQuestion,{env,fetcher:stub.fetcher});
    assert.equal(result.provider,'local');assert.equal(result.fallback,true);assert.equal(result.answer,matchQuestion(unknownQuestion).answer);
    assert.equal(stub.calls.length,0);
  }
});

test('F13: поле ответа задаётся явно, угадывание answer/reply/message не допускается',()=>{
  const payload={payload:{answer:'  Одобренный ответ  '},answer:'Другой ответ',reply:'Ещё один ответ',message:'Сообщение'};
  assert.equal(extractReply(payload,'payload.answer'),'Одобренный ответ');
  for(const path of ['', 'unknown', 'payload.reply', 'payload.0', 'payload.__proto__', 'constructor', 'payload.prototype'])assert.throws(()=>extractReply(payload,path));
  for(const invalid of [null,[],{payload:null},{payload:{answer:12}},{payload:{answer:false}},{payload:{answer:[]}},Object.create(payload)])assert.throws(()=>extractReply(invalid,'payload.answer'));
});

test('F14: неизвестный формат, пустой и чрезмерно длинный ответ не показываются пользователю',async()=>{
  for(const payload of [{answer:'Неподтверждённое поле'},null,{payload:{answer:''}},{payload:{answer:'   '}},{payload:{answer:'a'.repeat(10001)}},{payload:{answer:{text:'Вложенный объект'}}}]){
    const stub=spy(()=>jsonReply(payload));
    const result=await productHelp(actor,sessionToken,unknownQuestion,{env:configured(),fetcher:stub.fetcher});
    assert.equal(result.provider,'local');assert.equal(result.fallback,true);assert.equal(result.answer,matchQuestion(unknownQuestion).answer);
    assert.equal(stub.calls.length,1);
  }
});

test('F15: HTTP-ошибка, перенаправление, не-JSON и некорректный JSON дают локальный fallback',async()=>{
  const responses=[
    ()=>new Response('Provider internal error',{status:503}),
    ()=>new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}}),
    ()=>new Response('<script>unsafe()</script>',{headers:{'Content-Type':'text/html'}}),
    ()=>new Response('{broken json',{headers:{'Content-Type':'application/json'}}),
    ()=>new Response(null,{status:204})
  ];
  for(const response of responses){const stub=spy(response);const result=await productHelp(actor,sessionToken,unknownQuestion,{env:configured(),fetcher:stub.fetcher});assert.equal(result.provider,'local');assert.equal(result.fallback,true);assert.equal(stub.calls.length,1);}
});

test('F16: ограничение размера проверяется по заголовку и фактическим байтам потока',async()=>{
  const responses=[
    ()=>new Response(JSON.stringify({payload:{answer:'small'}}),{headers:{'Content-Type':'application/json','Content-Length':'65537'}}),
    ()=>new Response(JSON.stringify({payload:{answer:'Ж'.repeat(40000)}}),{headers:{'Content-Type':'application/json'}})
  ];
  for(const response of responses){const stub=spy(response);const result=await productHelp(actor,sessionToken,unknownQuestion,{env:configured(),fetcher:stub.fetcher});assert.equal(result.provider,'local');assert.equal(result.fallback,true);}
});

test('F17: сеть, timeout и недействительная сессия не ломают справку',async()=>{
  for(const error of [new TypeError('Simulated network unavailable'),new DOMException('Simulated timeout','TimeoutError')]){
    const stub=spy(()=>{throw error;});const result=await productHelp(actor,sessionToken,unknownQuestion,{env:configured(),fetcher:stub.fetcher});
    assert.equal(result.provider,'local');assert.equal(result.fallback,true);
    assert.ok(!JSON.stringify(result).includes('Simulated'));
  }
  const stub=spy();const result=await productHelp(actor,'short',unknownQuestion,{env:configured(),fetcher:stub.fetcher});
  assert.equal(result.provider,'local');assert.equal(result.fallback,true);assert.equal(stub.calls.length,0);
});

test('F18: утверждённые FAQ и динамические вопросы остаются локальными даже при готовом Bro24',async()=>{
  const stub=spy();const env=configured();
  for(const item of faqItems){const result=await productHelp(actor,sessionToken,item.question,{env,fetcher:stub.fetcher});assert.equal(result.provider,'local');assert.equal(result.fallback,false);assert.equal(result.answer,item.answer);}
  for(const [message,href] of [['Сколько стоит iPhone сегодня?','/compare'],['Где мой заказ?','/orders'],['Подтверди мой заказ','/orders'],['Подешевеет ли завтра?','/analytics'],['Какой остаток в наличии?','/compare']]){
    const result=await productHelp(actor,sessionToken,message,{env,fetcher:stub.fetcher});assert.equal(result.provider,'local');assert.equal(result.routeOnly,true);assert.equal(result.links[0].href,href);
  }
  assert.equal(stub.calls.length,0);
});

test('F19: локальный provider не зависит от внешнего ключа, а некорректные сообщения отвергаются до сети',async()=>{
  const stub=spy();const localEnv={CHATBOT_ENABLED:'true'};
  assert.deepEqual(chatbotState(localEnv),{provider:'local',available:true});
  const result=await productHelp(actor,'unused',unknownQuestion,{env:localEnv,fetcher:stub.fetcher});assert.equal(result.provider,'local');assert.equal(result.fallback,false);
  for(const message of ['', '   ', 'a'.repeat(1001)])await assert.rejects(productHelp(actor,sessionToken,message,{env:configured(),fetcher:stub.fetcher}),{code:'INVALID_CHAT_MESSAGE',status:400});
  assert.equal(stub.calls.length,0);
});

test('F20: модуль справки не подключает БД, инструменты заказов или исполнительный код',()=>{
  const source=readFileSync('src/server/product-help.ts','utf8');
  const imports=[...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
  const allowed=['node:crypto','../domain/flags','../domain/faq','../domain/errors','../domain/types'];
  assert.ok(imports.every(path=>allowed.includes(path)),JSON.stringify(imports));
  assert.doesNotMatch(source,/\b(eval|exec|spawn|query|transaction)\s*\(/);
  assert.doesNotMatch(source,/\bconsole\.(log|error|warn)\s*\(/);
});
