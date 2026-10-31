import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {configure,validateDomain} from '../configure.mjs';

const sample=await readFile(new URL('../../.env.example',import.meta.url),'utf8');
const fakeHash='$2a$14$'+'a'.repeat(53);
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'narxpilot-deploy-test-'));try{await writeFile(join(root,'.env.example'),sample);await fn(root);}finally{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('narxpilot-deploy-test-'));await rm(root,{recursive:true,force:true});}}
test('Домен без инъекции в Caddyfile, URL, порта и wildcard',()=>{
  assert.equal(validateDomain('narxpilot.software-engineer.online'),'narxpilot.software-engineer.online');
  for(const value of ['https://example.com','example.com:443','example.com/path','*.example.com','foo\nbar.com','example.com {','-x.example.com','localhost','EXAMPLE.COM'])assert.throws(()=>validateDomain(value));
});
test('Первый запуск создаёт отдельные секреты и HTTPS Origin, без раскрытия пароля в .env',()=>fixture(async root=>{
  const result=await configure({root});const env=parseEnv(await readFile(join(root,'.env'),'utf8'));
  assert.equal(result.finalized,false);assert.equal(env.APP_ORIGIN,'https://narxpilot.software-engineer.online');assert.equal(env.DEMO_MODE,'true');
  const keys=['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET'];assert.equal(new Set(keys.map(k=>env[k])).size,4);for(const key of keys)assert.ok(env[key].length>=32);
  const access=JSON.parse(await readFile(result.credentialsFile,'utf8'));assert.equal(access.username,'narxpilot');assert.ok(access.password.length>=24);assert.ok(!Object.values(env).includes(access.password));
  if(process.platform!=='win32')assert.equal((await stat(join(root,'.env'))).mode&0o777,0o600);
}));
test('Finalizer сохраняет буквальные $ bcrypt и повторный запуск не меняет секреты',()=>fixture(async root=>{
  await configure({root});await writeFile(join(root,'.local/deploy/auth-hash'),fakeHash+'\n');await configure({root,finalize:true});
  const before=await readFile(join(root,'.env'),'utf8');assert.equal(parseEnv(before).DEPLOY_BASIC_HASH,fakeHash);
  assert.ok(before.includes("DEPLOY_BASIC_HASH='"+fakeHash+"'"));await configure({root,finalize:true});assert.equal(await readFile(join(root,'.env'),'utf8'),before);
}));
test('Существующий API-ключ, ключ с $, неизвестная переменная и секреты сохраняются',()=>fixture(async root=>{
  await configure({root});let original=await readFile(join(root,'.env'),'utf8');original=original.replace(/^BRO24_API_KEY=.*$/m,"BRO24_API_KEY='fake-value-$literal-never-real'")+'CUSTOM_FIELD=keep-me\n';await writeFile(join(root,'.env'),original);
  const old=parseEnv(original);await configure({root,domain:'demo.example.com'});const current=parseEnv(await readFile(join(root,'.env'),'utf8'));
  assert.equal(current.BRO24_API_KEY,old.BRO24_API_KEY);assert.equal(current.SESSION_SECRET,old.SESSION_SECRET);assert.equal(current.CUSTOM_FIELD,'keep-me');assert.equal(current.APP_ORIGIN,'https://demo.example.com');
}));
test('Live/test база и слабый пароль отклоняются до изменения .env',()=>fixture(async root=>{
  for(const change of [sample.replace('DEMO_MODE=true','DEMO_MODE=false'),sample.replace('narxpilot_demo','narxpilot_test'),sample.replace('POSTGRES_PASSWORD=','POSTGRES_PASSWORD=short')]){
    await writeFile(join(root,'.env'),change);await assert.rejects(configure({root}));assert.equal(await readFile(join(root,'.env'),'utf8'),change);
  }
}));
test('Finalizer требует хеш и отвергает подмену, готовый хеш не требует открытого пароля',()=>fixture(async root=>{
  await assert.rejects(configure({root,finalize:true}),/bcrypt/);
  await writeFile(join(root,'.env'),sample+"\nDEPLOY_BASIC_HASH='invalid'\n");await assert.rejects(configure({root}),/bcrypt/);
  await writeFile(join(root,'.env'),sample+"\nDEPLOY_BASIC_HASH='"+fakeHash+"'\n");const result=await configure({root,finalize:true});assert.equal(result.finalized,true);
  await assert.rejects(readFile(join(root,'.local/deploy/basic-auth-password')),{code:'ENOENT'});
}));
test('Повторяющаяся управляемая переменная не заменяется молча',()=>fixture(async root=>{
  const input=sample+'\nAPP_ORIGIN=https://duplicate.example.com\n';await writeFile(join(root,'.env'),input);await assert.rejects(configure({root}),/Повторяющаяся/);assert.equal(await readFile(join(root,'.env'),'utf8'),input);
}));
test('Незакавыченный $ в API-ключе сохраняется буквально для Compose',()=>fixture(async root=>{
  await writeFile(join(root,'.env'),sample.replace(/^BRO24_API_KEY=.*$/m,'BRO24_API_KEY=fake-$UNDEFINED_KEY-literal'));
  await configure({root});const text=await readFile(join(root,'.env'),'utf8');
  assert.equal(parseEnv(text).BRO24_API_KEY,'fake-$UNDEFINED_KEY-literal');assert.ok(text.includes("BRO24_API_KEY='fake-$UNDEFINED_KEY-literal'"));
}));
test('При смене домена/логина метаданные доступа обновляются без смены пароля',()=>fixture(async root=>{
  const first=await configure({root});const original=JSON.parse(await readFile(first.credentialsFile,'utf8'));
  const env=await readFile(join(root,'.env'),'utf8');await writeFile(join(root,'.env'),env.replace("DEPLOY_BASIC_USER='narxpilot'","DEPLOY_BASIC_USER='reviewer'"));
  await configure({root,domain:'demo.example.com'});const updated=JSON.parse(await readFile(first.credentialsFile,'utf8'));
  assert.equal(updated.password,original.password);assert.equal(updated.url,'https://demo.example.com');assert.equal(updated.username,'reviewer');
}));
