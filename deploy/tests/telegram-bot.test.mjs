import test from 'node:test';
import assert from 'node:assert/strict';
import {commandReply,runTelegramBot} from '../telegram-bot.mjs';
const env={TG_BOT_TOKEN:'123456789:fake_test_token_never_use_live_123456'};
const update=(id=1,text='/start',type='private')=>({update_id:id,message:{chat:{id:42,type},from:{is_bot:false},text}});
const response=result=>({ok:true,json:async()=>({ok:true,result})});
test('Только private /start и /help получают утверждённую справку и web_app',()=>{
  const reply=commandReply(update(),'https://example.com/');assert.match(reply.text,/DEMO_MODE/);assert.equal(reply.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.com/');
  for(const value of [update(1,'купить товар'),update(1,'/start','group'),{callback_query:{}}])assert.equal(commandReply(value,'https://example.com/'),null);
  assert.ok(commandReply(update(1,'/help@NarxPilotBot'),'https://example.com/'));
});
test('Существующий webhook не удаляется и останавливает polling',async()=>{
  const calls=[];await assert.rejects(runTelegramBot({env,fetchImpl:async url=>{calls.push(url.split('/').at(-1));return response({url:'https://existing.example.com/secret'});}}),/webhook/);assert.deepEqual(calls,['getWebhookInfo']);
});
test('Polling подтверждает обработанный offset, использует heartbeat и остановку',async()=>{
  const controller=new AbortController(),calls=[];let beats=0;
  await runTelegramBot({env,signal:controller.signal,heartbeat:async()=>{beats++;},fetchImpl:async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({method,body});if(method==='getWebhookInfo')return response({url:''});if(method==='sendMessage')return response({message_id:1});if(calls.filter(c=>c.method==='getUpdates').length===1){assert.equal(body.timeout,25);assert.deepEqual(body.allowed_updates,['message']);return response([update(7)]);}assert.equal(body.offset,8);controller.abort();return response([]);}});
  assert.equal(calls.filter(c=>c.method==='sendMessage').length,1);assert.ok(beats>=2);
});
test('Ошибки повторяются с задержкой, auth ошибка завершается без утечки токена',async()=>{
  const controller=new AbortController();const waits=[];
  await runTelegramBot({env,signal:controller.signal,heartbeat:async()=>{},log:()=>{},sleep:async ms=>{waits.push(ms);controller.abort();},fetchImpl:async url=>{if(url.endsWith('getWebhookInfo'))return response({url:''});throw new Error(env.TG_BOT_TOKEN);}});assert.deepEqual(waits,[2000]);
  await assert.rejects(runTelegramBot({env,fetchImpl:async url=>url.endsWith('getWebhookInfo')?response({url:''}):{ok:false,status:401,json:async()=>({ok:false,error_code:401,description:env.TG_BOT_TOKEN})}}),error=>/отклонил токен/.test(error.message)&&!error.message.includes(env.TG_BOT_TOKEN));
});
