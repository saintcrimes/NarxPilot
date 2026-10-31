import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {configure} from '../configure.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fixtureBase=join(root,'.local','deploy-compose-tests');
const projectName='narxpilot-deploy-check-'+randomBytes(6).toString('hex');
const realDocker=process.env.RUN_DOCKER_TESTS==='true';
const version=spawnSync('docker',['compose','version','--short'],{encoding:'utf8',timeout:15000,windowsHide:true});
const composeAvailable=!version.error&&version.status===0;
const composeSkip=!composeAvailable&&!realDocker?'Docker Compose CLI отсутствует; проверка явно пропущена':false;
const fakeKey='fake-compose-bro24-$literal-never-real';
const fakeOpenAIKey='fake-compose-openai-never-real';
let fixture,environment,config,childEnvironment,composeResourcesStarted=false;

function command(args,{input,timeout=30000}={}){
  const result=spawnSync('docker',args,{input,encoding:'utf8',timeout,maxBuffer:4*1024*1024,windowsHide:true,env:childEnvironment??process.env});
  // Never dump a resolved compose document or the fixture's generated passwords.
  assert.equal(result.error?.code,undefined,`Docker command failed to start: ${result.error?.code??''}`);
  assert.equal(result.status,0,`Docker command failed (exit ${result.status}); ${result.stderr?.slice(0,700)??''}`);
  return result.stdout;
}
function composeArgs(...args){return ['compose','--project-name',projectName,'--project-directory',root,'--env-file',join(fixture,'.env'),'-f',join(root,'deploy','compose.yml'),...args];}
// Compose's JSON renderer may escape literal dollar signs for YAML round-tripping.
const literal=value=>typeof value==='string'?value.replace(/\$\$/g,'$'):value;

before(async()=>{
  if(!composeAvailable){assert.equal(realDocker,false,'RUN_DOCKER_TESTS=true требует Docker Compose CLI');return;}
  await mkdir(fixtureBase,{recursive:true});fixture=await mkdtemp(join(fixtureBase,'fixture-'));
  const sample=await readFile(join(root,'.env.example'),'utf8');
  await writeFile(join(fixture,'.env.example'),sample);
  await configure({root:fixture,domain:'deploy-check.example.com'});
  let text=await readFile(join(fixture,'.env'),'utf8');
  text=text.replace(/^BRO24_API_KEY=.*$/m,"BRO24_API_KEY='"+fakeKey+"'").replace(/^OPENAI_API_KEY=.*$/m,"OPENAI_API_KEY='"+fakeOpenAIKey+"'");
  await writeFile(join(fixture,'.env'),text,{mode:0o600});
  environment=parseEnv(await readFile(join(fixture,'.env'),'utf8'));
  childEnvironment={...process.env};
  // Host variables must not override the isolated fixture or bring actual keys into tests.
  for(const key of [...Object.keys(environment),'COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_ENV_FILES','COMPOSE_PROFILES'])delete childEnvironment[key];
  childEnvironment.COMPOSE_DISABLE_ENV_FILE='1';
  config=JSON.parse(command(composeArgs('config','--format','json')));
});

after(async()=>{
  if(!fixture)return;
  if(composeResourcesStarted){
    assert.match(projectName,/^narxpilot-deploy-check-[a-f0-9]{12}$/);
    command(composeArgs('down','--volumes','--remove-orphans'),{timeout:90000});
  }
  const base=await realpath(fixtureBase),directory=await realpath(fixture);
  const nested=relative(base,directory);
  assert.ok(nested.startsWith('fixture-')&&!nested.includes(sep)&&!nested.startsWith('..'),'Cleanup только внутри созданного fixture');
  const withinWorkspace=relative(await realpath(root),directory);
  assert.ok(withinWorkspace&&!withinWorkspace.startsWith('..')&&!withinWorkspace.startsWith(sep),'Cleanup только внутри workspace');
  await rm(directory,{recursive:true,force:true});
});

test('Серверный Compose публикует только Caddy 80/443; PostgreSQL и web остаются внутренними',{skip:composeSkip},()=>{
  const ports=Object.entries(config.services).flatMap(([name,service])=>(service.ports??[]).map(port=>({name,target:port.target,published:String(port.published),protocol:port.protocol??'tcp'})));
  assert.deepEqual(ports.sort((a,b)=>`${a.published}/${a.protocol}`.localeCompare(`${b.published}/${b.protocol}`)),[
    {name:'caddy',target:443,published:'443',protocol:'tcp'},
    {name:'caddy',target:443,published:'443',protocol:'udp'},
    {name:'caddy',target:80,published:'80',protocol:'tcp'}
  ]);
  assert.ok(config.services.web.expose.map(String).includes('3000'));
  assert.equal(config.services.caddy.image,'caddy:2.11.7-alpine');
  assert.equal(config.services.db.image,'postgres:18.4-bookworm');
  const caddyfile=config.services.caddy.volumes.find(volume=>volume.target==='/etc/caddy/Caddyfile');
  assert.equal(resolve(caddyfile.source),join(root,'deploy','Caddyfile'));
  assert.equal(caddyfile.read_only,true);
  assert.ok(Object.keys(config.volumes).includes('database'));
});

test('Compose разделяет ключи и роли; сохраняет HTTPS Origin и буквальные $ в API-ключе',{skip:composeSkip},()=>{
  const web=config.services.web.environment,worker=config.services.worker.environment,migrate=config.services.migrate.environment,caddy=config.services.caddy.environment;
  assert.equal(web.APP_ORIGIN,'https://deploy-check.example.com');
  assert.equal(web.DEMO_MODE,'true');
  assert.equal(literal(web.BRO24_API_KEY),fakeKey);
  assert.equal(web.OPENAI_API_KEY,fakeOpenAIKey);
  assert.equal(caddy.NARXPILOT_DOMAIN,'deploy-check.example.com');
  assert.deepEqual(Object.keys(caddy),['NARXPILOT_DOMAIN']);
  const webUrl=new URL(web.DATABASE_URL),workerUrl=new URL(worker.WORKER_DATABASE_URL),ownerUrl=new URL(migrate.MIGRATION_DATABASE_URL);
  assert.equal(webUrl.username,'narxpilot_web');assert.equal(webUrl.password,environment.WEB_DB_PASSWORD);
  assert.equal(workerUrl.username,'narxpilot_worker');assert.equal(workerUrl.password,environment.WORKER_DB_PASSWORD);
  assert.equal(ownerUrl.username,environment.POSTGRES_USER);assert.equal(ownerUrl.password,environment.POSTGRES_PASSWORD);
  assert.equal(config.services.db.environment.POSTGRES_PASSWORD,environment.POSTGRES_PASSWORD);
  for(const key of ['POSTGRES_PASSWORD','MIGRATION_DATABASE_URL','WORKER_DB_PASSWORD','WORKER_DATABASE_URL','DEPLOY_BASIC_HASH'])assert.equal(web[key],undefined,`Web не получает ${key}`);
  for(const key of ['POSTGRES_PASSWORD','MIGRATION_DATABASE_URL','DATABASE_URL','SESSION_SECRET','OPENAI_API_KEY','BRO24_API_KEY','DEPLOY_BASIC_HASH'])assert.equal(worker[key],undefined,`Worker не получает ${key}`);
  for(const key of ['SESSION_SECRET','OPENAI_API_KEY','BRO24_API_KEY','DEPLOY_BASIC_HASH'])assert.equal(migrate[key],undefined,`Migrator не получает ${key}`);
});

test('Публичный Caddyfile не содержит HTTP-пароль или ответ 401',async()=>{
  const caddyfile=await readFile(join(root,'deploy','Caddyfile'),'utf8');
  assert.doesNotMatch(caddyfile,/\b(?:basic_auth|basicauth|forward_auth|DEPLOY_BASIC_USER|DEPLOY_BASIC_HASH)\b|\brespond\s+401\b/);
  assert.match(caddyfile,/reverse_proxy\s+web:3000/);
});

test('Реальный Caddy принимает публичную HTTPS-конфигурацию без обработчика authentication',{skip:realDocker?composeSkip:'Требует RUN_DOCKER_TESTS=true и доступный Docker daemon',timeout:180000},()=>{
  composeResourcesStarted=true;
  command(composeArgs('run','--rm','--no-deps','-T','--interactive=false','caddy','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'),{timeout:180000});
  const adapted=JSON.parse(command(composeArgs('run','--rm','--no-deps','-T','--interactive=false','caddy','caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'),{timeout:180000}));
  const handlers=[];
  function visit(value){if(value&&typeof value==='object'){if(typeof value.handler==='string')handlers.push(value.handler);for(const child of Object.values(value))visit(child);}}
  visit(adapted);assert.ok(handlers.includes('reverse_proxy'));assert.ok(!handlers.includes('authentication'));
});
