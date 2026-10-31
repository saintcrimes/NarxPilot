import test from 'node:test';
import assert from 'node:assert/strict';
import {configureTelegram,telegramCall,telegramSettings} from '../telegram.mjs';
const token='123456789:fake_test_token_never_use_live_123456';
const env={TG_BOT_TOKEN:token};
const bot={id:123456789,is_bot:true,username:'NarxPilotTestBot'};
const response=result=>({ok:true,json:async()=>({ok:true,result})});
test('--check делает только getMe без изменения кнопки',async()=>{
  const calls=[];const result=await configureTelegram({env,check:true,fetchImpl:async(url,options)=>{calls.push([url,options]);return response(bot);}});
  assert.equal(result.configured,false);assert.equal(calls.length,1);assert.ok(calls[0][0].endsWith('/getMe'));assert.equal(calls[0][1].redirect,'error');assert.ok(!JSON.stringify(result).includes(token));
});
test('Настройка следует контракту Telegram и проверяет сохранённую кнопку',async()=>{
  const calls=[];let menu;const result=await configureTelegram({env,fetchImpl:async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push(method);if(method==='getMe')return response(bot);if(method==='setChatMenuButton'){menu=body.menu_button;assert.deepEqual(Object.keys(body),['menu_button']);return response(true);}return response(menu);}});
  assert.deepEqual(calls,['getMe','setChatMenuButton','getChatMenuButton']);assert.deepEqual(menu,{type:'web_app',text:'Открыть NarxPilot',web_app:{url:'https://narxpilot.software-engineer.online/'}});assert.equal(result.configured,true);
});
test('Ошибка, таймаут и ответ API не раскрывают токен или URL',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('https://api.telegram.org/bot'+token);},async()=>({ok:false}),async()=>({ok:true,json:async()=>({ok:false,description:token})})])await assert.rejects(telegramCall(token,'getMe',{},fetchImpl),error=>!error.message.includes(token)&&!error.message.includes('https:'));
  await assert.rejects(telegramCall(token,'getMe',{},async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error(token)))),5),/вовремя/);
});
test('Неверный адрес/токен и несовпавшая кнопка отклоняются',async()=>{
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/#secret'])assert.throws(()=>telegramSettings({...env,TELEGRAM_MINI_APP_URL:url}));
  assert.throws(()=>telegramSettings({}));assert.equal(telegramSettings({...env,APP_URL:'https://example.com/mini'}).url,'https://example.com/mini');
  await assert.rejects(configureTelegram({env,fetchImpl:async url=>response(url.endsWith('getMe')?bot:url.endsWith('setChatMenuButton')?true:{type:'default'})}),/не прошла/);
});
