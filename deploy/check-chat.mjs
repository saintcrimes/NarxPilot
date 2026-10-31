import {randomUUID} from 'node:crypto';

// Явная диагностическая команда: один безопасный вопрос, без заказов и истории.
const key=process.env.BRO24_API_KEY?.trim();
if(!key){console.error('BRO24_API_KEY не задан в серверном .env.');process.exit(2);}
try{
  const response=await fetch('https://dashboard.bro24.uz/api/v1/public/chat',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{'X-API-Key':key,'Content-Type':'application/json'},
    body:JSON.stringify({client_id:'narxpilot-check-'+randomUUID(),channel:'website',message:'Как найти точный товар в NarxPilot?'})
  });
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty body');
  const chunks=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new Error('Body too large');}chunks.push(part.value);}
  let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{console.log(JSON.stringify({http_status:response.status,json:false}));process.exit(1);}
  const candidates=[];
  function inspect(value,parts=[]){if(parts.length>5||!value||typeof value!=='object'||Array.isArray(value))return;
    for(const [name,child]of Object.entries(value).slice(0,50)){
      if(!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(name)||/token|key|secret|auth/i.test(name))continue;
      const path=[...parts,name];
      if(typeof child==='string'&&/reply|answer|response|message|text|content/i.test(name))candidates.push({path:path.join('.'),characters:child.length,mentions_narxpilot:/narxpilot/i.test(child)});
      else inspect(child,path);
    }
  }
  inspect(payload);
  console.log(JSON.stringify({http_status:response.status,json:true,candidate_reply_fields:candidates},null,2));
  if(!response.ok)process.exitCode=1;
  else console.log('Проверьте смысл поля ответа в документации Bro24 и задайте BRO24_REPLY_JSON_PATH. Содержимое ответа и ключ не выведены.');
}catch(error){console.error(JSON.stringify({request_failed:true,error_type:error?.name??'Error',network_code:error?.cause?.code??null}));process.exitCode=1;}
