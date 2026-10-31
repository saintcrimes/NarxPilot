import {readFile,writeFile,mkdir,chmod,rename,lstat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateDomain(domain){
  if(typeof domain!=='string'||domain.length>253||!domain.includes('.')||!domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)))throw new Error('Нужен домен без протокола, порта, пути и специальных символов.');
  return domain;
}
async function readOptional(path){try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function regularOrMissing(path){try{if(!(await lstat(path)).isFile())throw new Error('Ожидался обычный файл конфигурации.');}catch(e){if(e.code!=='ENOENT')throw e;}}
function replaceValue(text,key,value){
  if(/[\r\n']/.test(value))throw new Error('Недопустимое значение конфигурации '+key);
  const line=key+"='"+value+"'";
  const expression=new RegExp('^(?:export\\s+)?'+key+'\\s*=.*$','gm');
  const matches=text.match(expression)??[];if(matches.length>1)throw new Error('Повторяющаяся переменная '+key);
  return matches.length?text.replace(expression,()=>line):text.replace(/\s*$/,'')+'\n'+line+'\n';
}
// Legacy callers may still pass finalize; public demo configuration needs no auth stage.
export async function configure({root=process.cwd(),domain='narxpilot.software-engineer.online'}={}){
  domain=validateDomain(domain);root=resolve(root);
  const envPath=join(root,'.env'),privateDir=join(root,'.local','deploy');
  await regularOrMissing(envPath);
  const original=await readOptional(envPath),example=await readFile(join(root,'.env.example'),'utf8');
  let text=original??example;const current=parseEnv(text),defaults=parseEnv(example),changes={};
  for(const [key,value]of Object.entries(defaults))if(!(key in current))changes[key]=value;
  const values={...defaults,...current};
  if(values.DEMO_MODE!=='true'||!/^narxpilot_demo(?:_[a-z0-9]+)?$/.test(values.POSTGRES_DB??''))throw new Error('Автоустановка поддерживает только отдельную demo-базу. Live/test конфигурация сохранена без изменения.');
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(values.POSTGRES_USER??''))throw new Error('Неверное имя владельца БД.');
  for(const key of ['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD']){
    if(!values[key])values[key]=changes[key]=randomBytes(24).toString('hex');
    if(!/^[a-zA-Z0-9]{32,}$/.test(values[key]))throw new Error('Пароль '+key+' должен содержать не менее 32 букв/цифр; существующее значение не менялось.');
  }
  if(!values.SESSION_SECRET)values.SESSION_SECRET=changes.SESSION_SECRET=randomBytes(40).toString('hex');
  if(values.SESSION_SECRET.length<32)throw new Error('SESSION_SECRET должен содержать минимум 32 символа.');
  // Compose interpolates unquoted $NAME; preserve the actual secret bytes with literal quoting.
  for(const key of ['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET','BRO24_API_KEY','OPENAI_API_KEY'])changes[key]=values[key]??'';
  for(const [key,user,password]of [['DATABASE_URL','narxpilot_web',values.WEB_DB_PASSWORD],['WORKER_DATABASE_URL','narxpilot_worker',values.WORKER_DB_PASSWORD],['MIGRATION_DATABASE_URL',values.POSTGRES_USER,values.POSTGRES_PASSWORD]])if(!values[key])changes[key]=`postgresql://${user}:${password}@db:5432/${values.POSTGRES_DB}`;
  changes.NARXPILOT_DOMAIN=domain;changes.APP_ORIGIN='https://'+domain;
  await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
  // Older access.json, auth-hash, basic-auth-password and DEPLOY_BASIC_* values
  // are retained untouched. They no longer configure or restrict website access.
  for(const [key,value]of Object.entries(changes))text=replaceValue(text,key,value);
  // A concurrent edit must never be overwritten silently.
  if((await readOptional(envPath))!==original)throw new Error('.env изменился во время настройки; повторите команду.');
  if(text!==original){
    if(original!==null)await writeFile(join(privateDir,'env-before-'+Date.now()+'.txt'),original,{flag:'wx',mode:0o600});
    const temp=join(privateDir,'env-'+randomBytes(8).toString('hex')+'.tmp');
    await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,envPath);
  }
  await chmod(envPath,0o600);
  return {domain,finalized:true,publicDemo:true,credentialsFile:null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    let domain='narxpilot.software-engineer.online',finalize=false;
    for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--domain'&&process.argv[i+1])domain=process.argv[++i];else if(process.argv[i]==='--finalize')finalize=true;else throw new Error('Аргументы: --domain DOMAIN [--finalize]');}
    const result=await configure({domain,finalize});console.log('Конфигурация для https://'+result.domain+' сохранена. Секреты не выводятся.');
    console.log('Открыт публичный DEMO_MODE со синтетическими данными. Пароль для доступа к сайту не требуется.');
  }catch(e){console.error(e.message);process.exitCode=1;}
}
