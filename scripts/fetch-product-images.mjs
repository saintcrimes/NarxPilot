import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.cwd();
const photos=JSON.parse(await readFile(resolve(root,'src/data/product-images.json'),'utf8'));
const allowed=new Set(['cdsassets.apple.com','samsungbrshop.vtexassets.com','shop.samsung.com','i02.appmifile.com','www.honor.com','www-file.honor.com','mtscdn.ru','storage.comprasmartphone.com','www.hp.com']);
async function fetchImage(address){
  let url=new URL(address);
  for(let hop=0;hop<4;hop++){
    if(url.protocol!=='https:'||!allowed.has(url.hostname))throw new Error('Unapproved image host');
    const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw new Error('Image redirect missing');url=new URL(location,url);continue;}
    return response;
  }
  throw new Error('Too many image redirects');
}
const directory=resolve(root,'public/products');await mkdir(directory,{recursive:true});
for(const photo of photos){
  const url=new URL(photo.url);if(url.protocol!=='https:'||!allowed.has(url.hostname)||!/^[-a-z0-9]+\.(png|jpg|webp)$/.test(photo.file))throw new Error('Invalid product image manifest');
  const target=resolve(directory,photo.file);try{await access(target);continue;}catch{}
  const response=await fetchImage(url);if(!response.ok)throw new Error('Image unavailable: '+photo.model+' HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=bytes[0]===255&&bytes[1]===216;const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(bytes.length<100||bytes.length>8000000||!png&&!jpeg&&!webp)throw new Error('Invalid raster image: '+photo.model);
  await writeFile(target,bytes);console.log(photo.model+': '+bytes.length+' bytes');
}
