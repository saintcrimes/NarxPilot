import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function telegramSettings(env){
  const token=(env.TG_BOT_TOKEN||env.TELEGRAM_BOT_TOKEN||'').trim();
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))throw new Error('Задайте корректный TG_BOT_TOKEN в серверном .env.');
  let url;try{url=new URL(env.TELEGRAM_MINI_APP_URL||env.APP_URL||'https://narxpilot.software-engineer.online/');}catch{throw new Error('Неверный адрес Telegram Mini App.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Telegram Mini App требует HTTPS URL без пароля и fragment.');
  return {token,url:url.href};
}
export async function loadTelegramEnv(root=process.cwd(),environment=process.env){
  let file={};try{file=parseEnv(await readFile(resolve(root,'.env'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Не удалось прочитать серверный .env.');}
  return {...file,...environment};
}
export class TelegramApiError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
export async function telegramCall(token,method,body={},fetchImpl=fetch,timeoutMs=10000,signal){
  if(!['getMe','setChatMenuButton','getChatMenuButton','getWebhookInfo','getUpdates','sendMessage'].includes(method))throw new Error('Недопустимый метод настройки Telegram.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal,redirect:'error'});
    const payload=await response.json();
    if(!response.ok||payload?.ok!==true)throw new TelegramApiError(Number.isInteger(payload?.error_code)?payload.error_code:response.status,'Ошибка Telegram API. Проверьте токен и соединение; секреты не выводятся.');
    return payload.result;
  }catch(error){
    if(error instanceof TelegramApiError)throw error;
    // Fetch errors and Telegram descriptions may contain the token-bearing URL.
    throw new Error(controller.signal.aborted?'Telegram не ответил вовремя. Повторите команду.':'Ошибка Telegram API. Проверьте токен и соединение; секреты не выводятся.');
  }finally{clearTimeout(timer);}
}
export async function configureTelegram({env,check=false,fetchImpl=fetch,timeoutMs=10000}){
  const {token,url}=telegramSettings(env);
  const call=(method,body)=>telegramCall(token,method,body,fetchImpl,timeoutMs);
  const bot=await call('getMe',{});
  if(bot?.is_bot!==true||!Number.isSafeInteger(bot.id)||typeof bot.username!=='string'||!/^\w+$/.test(bot.username))throw new Error('Telegram не подтвердил аккаунт бота.');
  if(check)return {username:bot.username,configured:false};
  const menu={type:'web_app',text:'Открыть NarxPilot',web_app:{url}};
  if(await call('setChatMenuButton',{menu_button:menu})!==true)throw new Error('Telegram не подтвердил сохранение кнопки.');
  const saved=await call('getChatMenuButton',{});
  if(saved?.type!==menu.type||saved.text!==menu.text||saved.web_app?.url!==url)throw new Error('Проверка сохранённой кнопки Telegram не прошла.');
  return {username:bot.username,configured:true,url};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.slice(2).some(value=>value!=='--check'))throw new Error('Команда: node deploy/telegram.mjs [--check]');
    const result=await configureTelegram({env:await loadTelegramEnv(),check:process.argv.includes('--check')});
    console.log(result.configured?`Кнопка «Открыть NarxPilot» настроена и проверена для @${result.username}.`:`Токен проверен: @${result.username}. Настройки не изменялись.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
