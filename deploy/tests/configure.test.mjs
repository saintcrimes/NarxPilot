import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {configure,validateDomain} from '../configure.mjs';

const sample=await readFile(new URL('../../.env.example',import.meta.url),'utf8');
const fakeHash='$2a$14$'+'a'.repeat(53);
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'narxpilot-deploy-test-'));try{await writeFile(join(root,'.env.example'),sample);await fn(root);}finally{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('narxpilot-deploy-test-'));await rm(root,{recursive:true,force:true});}}
test('Домен без инъекции в Caddyfile, URL, порта и wildcard',()=>{
  assert.equal(validateDomain('narxpilot.software-engineer.online'),'narxpilot.software-engineer.online');
  for(const value of ['https://example.com','example.com:443','example.com/path','*.example.com','foo\nbar.com','example.com {','-x.example.com','localhost','EXAMPLE.COM'])assert.throws(()=>validateDomain(value));
});
test('Первый запуск создаёт приватные секреты и публичный HTTPS demo без пароля сайта',()=>fixture(async root=>{
  const result=await configure({root});const env=parseEnv(await readFile(join(root,'.env'),'utf8'));
  assert.equal(result.finalized,true);assert.equal(result.publicDemo,true);assert.equal(result.credentialsFile,null);assert.equal(env.APP_ORIGIN,'https://narxpilot.software-engineer.online');assert.equal(env.DEMO_MODE,'true');
  const keys=['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET'];assert.equal(new Set(keys.map(k=>env[k])).size,4);for(const key of keys)assert.ok(env[key].length>=32);
  assert.equal(env.DEPLOY_BASIC_USER,undefined);assert.equal(env.DEPLOY_BASIC_HASH,undefined);
  for(const name of ['basic-auth-password','access.json','auth-hash'])await assert.rejects(readFile(join(root,'.local','deploy',name)),{code:'ENOENT'});
  if(process.platform!=='win32')assert.equal((await stat(join(root,'.env'))).mode&0o777,0o600);
}));
test('Совместимый finalize больше не требует bcrypt; повторный запуск не меняет секреты',()=>fixture(async root=>{
  const first=await configure({root,finalize:true});assert.equal(first.finalized,true);
  const before=await readFile(join(root,'.env'),'utf8');await configure({root,finalize:true});assert.equal(await readFile(join(root,'.env'),'utf8'),before);
  await assert.rejects(readFile(join(root,'.local','deploy','auth-hash')),{code:'ENOENT'});
}));
test('Существующий API-ключ, ключ с $, неизвестная переменная и секреты сохраняются',()=>fixture(async root=>{
  await configure({root});let original=await readFile(join(root,'.env'),'utf8');original=original.replace(/^BRO24_API_KEY=.*$/m,"BRO24_API_KEY='fake-value-$literal-never-real'")+'CUSTOM_FIELD=keep-me\n';await writeFile(join(root,'.env'),original);
  const old=parseEnv(original);await configure({root,domain:'demo.example.com'});const current=parseEnv(await readFile(join(root,'.env'),'utf8'));
  assert.equal(current.BRO24_API_KEY,old.BRO24_API_KEY);for(const key of ['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET'])assert.equal(current[key],old[key]);assert.equal(current.CUSTOM_FIELD,'keep-me');assert.equal(current.APP_ORIGIN,'https://demo.example.com');
}));
test('Live/test база и слабый пароль отклоняются до изменения .env',()=>fixture(async root=>{
  for(const change of [sample.replace('DEMO_MODE=true','DEMO_MODE=false'),sample.replace('narxpilot_demo','narxpilot_test'),sample.replace('POSTGRES_PASSWORD=','POSTGRES_PASSWORD=short')]){
    await writeFile(join(root,'.env'),change);await assert.rejects(configure({root}));assert.equal(await readFile(join(root,'.env'),'utf8'),change);
  }
}));
test('Неиспользуемые старые параметры и файлы доступа сохраняются побайтно без чтения их формата',()=>fixture(async root=>{
  const legacyEnv="\nDEPLOY_BASIC_USER='former login / unchanged'\nDEPLOY_BASIC_HASH='invalid-but-unused'\n";
  await writeFile(join(root,'.env'),sample+legacyEnv);await mkdir(join(root,'.local','deploy'),{recursive:true});
  const files={'access.json':'legacy invalid JSON remains untouched\n','basic-auth-password':'old-test-password-not-real\n','auth-hash':fakeHash+'\n'};
  for(const [name,value]of Object.entries(files))await writeFile(join(root,'.local','deploy',name),value,{mode:0o600});
  const result=await configure({root,domain:'demo.example.com',finalize:true});assert.equal(result.publicDemo,true);
  const text=await readFile(join(root,'.env'),'utf8');assert.ok(text.includes(legacyEnv));
  for(const [name,value]of Object.entries(files))assert.equal(await readFile(join(root,'.local','deploy',name),'utf8'),value);
}));
test('Повторяющаяся управляемая переменная не заменяется молча',()=>fixture(async root=>{
  const input=sample+'\nAPP_ORIGIN=https://duplicate.example.com\n';await writeFile(join(root,'.env'),input);await assert.rejects(configure({root}),/Повторяющаяся/);assert.equal(await readFile(join(root,'.env'),'utf8'),input);
}));
test('Незакавыченный $ в API-ключе сохраняется буквально для Compose',()=>fixture(async root=>{
  await writeFile(join(root,'.env'),sample.replace(/^BRO24_API_KEY=.*$/m,'BRO24_API_KEY=fake-$UNDEFINED_KEY-literal'));
  await configure({root});const text=await readFile(join(root,'.env'),'utf8');
  assert.equal(parseEnv(text).BRO24_API_KEY,'fake-$UNDEFINED_KEY-literal');assert.ok(text.includes("BRO24_API_KEY='fake-$UNDEFINED_KEY-literal'"));
}));
test('CLI принимает старый --finalize и сообщает публичный demo без раскрытия секретов',()=>fixture(async root=>{
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../configure.mjs',import.meta.url)),'--domain','demo.example.com','--finalize'],{cwd:root,encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/публичный DEMO_MODE/);assert.match(cli.stdout,/Пароль для доступа к сайту не требуется/);
  const env=parseEnv(await readFile(join(root,'.env'),'utf8'));
  for(const key of ['POSTGRES_PASSWORD','WEB_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET'])assert.ok(!cli.stdout.includes(env[key]));
  await assert.rejects(readFile(join(root,'.local','deploy','access.json')),{code:'ENOENT'});
}));
