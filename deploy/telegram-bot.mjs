import {writeFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {telegramSettings,telegramCall,loadTelegramEnv} from './telegram.mjs';

export const heartbeatPath='/tmp/telegram-heartbeat';
export function commandReply(update,url,demo=true){
  const message=update?.message;
  if(message?.chat?.type!=='private'||!Number.isSafeInteger(message.chat.id)||message.chat.id<=0||message.from?.is_bot||typeof message.text!=='string'||!/^\/(start|help)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text))return null;
  return {chat_id:message.chat.id,text:'NarxPilot — B2B-закупки и аналитика фактических цен. Сравнивайте точные товары, согласуйте условия и ведите закупку до приёмки.'+(demo?'\n\nDEMO_MODE: товары, поставщики и сделки синтетические.':'')+'\n\nОткройте приложение: можно войти в свой аккаунт или выбрать доступный демоаккаунт. Бот не оформляет закупки и не анализирует сделки.',reply_markup:{inline_keyboard:[[{text:'Открыть NarxPilot',web_app:{url}}]]}};
}
export async function runTelegramBot({env,signal,fetchImpl=fetch,heartbeat=()=>writeFile(heartbeatPath,String(Date.now()),{mode:0o600}),sleep=ms=>delay(ms,undefined,{signal}),log=message=>console.error(message)}){
  const {token,url}=telegramSettings(env);
  const call=(method,body={},timeout=10000)=>telegramCall(token,method,body,fetchImpl,timeout,signal);
  const webhook=await call('getWebhookInfo');
  if(typeof webhook?.url!=='string')throw new Error('Telegram не вернул настройки webhook.');
  if(webhook.url)throw new Error('У бота уже настроен webhook. Polling остановлен: проверьте существующую интеграцию и отключите webhook вручную, если она больше не нужна.');
  let offset=0,failures=0;
  while(!signal?.aborted){
    try{
      const updates=await call('getUpdates',{offset,timeout:25,limit:20,allowed_updates:['message']},35000);
      if(!Array.isArray(updates))throw new Error('Некорректный ответ Telegram.');
      await heartbeat();
      for(const update of updates){
        if(signal?.aborted)break;
        if(!Number.isSafeInteger(update.update_id)||update.update_id<offset)continue;
        const reply=commandReply(update,url,env.DEMO_MODE!=='false');
        if(reply){try{await call('sendMessage',reply);}catch(error){if(error.code!==403)throw error;}}
        offset=update.update_id+1;await heartbeat();
      }
      failures=0;
    }catch(error){
      if(signal?.aborted)break;
      if(error.code===401||error.code===404)throw new Error('Telegram отклонил токен. Проверьте TG_BOT_TOKEN и перезапустите сервис.');
      if(error.code===409)throw new Error('Telegram polling конфликтует с другим процессом или webhook. Оставьте один экземпляр бота.');
      failures++;log('Временная ошибка Telegram. Повтор с ограниченной задержкой; данные сообщений не журналируются.');
      try{await sleep(Math.min(30000,1000*2**Math.min(failures,5)));}catch{if(signal?.aborted)break;throw new Error('Ожидание Telegram прервано.');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
  try{
    if(process.argv[2]==='--health'){const file=await stat(heartbeatPath);if(Date.now()-file.mtimeMs>90000)throw new Error('Telegram heartbeat устарел.');}
    else if(process.argv.length>2)throw new Error('Команда: node deploy/telegram-bot.mjs [--health]');
    else await runTelegramBot({env:await loadTelegramEnv(),signal:controller.signal});
  }catch(error){if(!controller.signal.aborted){console.error(error.message);process.exitCode=1;}}
}
