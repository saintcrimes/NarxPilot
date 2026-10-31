import 'dotenv/config';
import { createHash } from 'node:crypto';
import { pool, transaction } from '../src/server/db';
import { isDemo, validateDatabase } from '../src/server/config';
import { Decimal, money } from '../src/domain/money';
import { seedAdditionalDemoProducts } from './seed-additional';
export const demoId=(name:string)=>{
  const h=createHash('sha256').update('narxpilot-v1:'+name).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
export async function seedDemo() {
  if(!isDemo()) throw new Error('Seed разрешён только для DEMO_MODE');
  validateDatabase(process.env.DATABASE_URL!);
  const anchor=process.env.DEMO_ANCHOR_DATE??'2026-10-31';
  const start=new Date(`${anchor}T00:00:00+05:00`).getTime()-180*86400000;
  const salt=Number(process.env.DEMO_SEED??31012026)%7;
  return transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('demo-seed'))");
    const identity=(await db.query('SELECT * FROM database_identity WHERE singleton FOR UPDATE')).rows[0];
    if(identity?.data_origin!=='synthetic') throw new Error('Это не демобаза');
    if(identity.seed_version) {const added=await seedAdditionalDemoProducts(db,demoId);console.log(`Основной seed сохранён. Добавлено новых синтетических SKU: ${added}; существующие данные не изменялись.`);return;}
    if((await db.query('SELECT 1 FROM organizations LIMIT 1')).rowCount) throw new Error('Seed требует пустой демобазы');
    await db.query("INSERT INTO locations(id,name) VALUES('malika','Малика'),('chilanzar','Чиланзар')");
    const profiles=[['buyer','Магазин «Орион»','buyer'],['buyer2','Магазин «Вектор»','buyer'],['admin','Проверка данных','admin'],
      ...['Atlas Mobile','Samarqand Digital','Navro‘z Supply','Chorsu Devices','Tashkent Smart'].map((n,i)=>[`supplier${i}`,`${n} · демо`,'supplier'])];
    for(const [key,name,role] of profiles) {
      await db.query('INSERT INTO organizations(id,name,kind) VALUES($1,$2,$3)',[demoId(key),name,role]);
      await db.query('INSERT INTO users(id,name,is_demo) VALUES($1,$2,true)',[demoId('user-'+key),name]);
      await db.query('INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,$3)',[demoId('user-'+key),demoId(key),role]);
    }
    for(let seller=0;seller<5;seller++) {
      await db.query('INSERT INTO warehouses(id,organization_id,location_id,name) VALUES($1,$2,$3,$4)',[demoId('warehouse'+seller),demoId('supplier'+seller),seller<3?'malika':'chilanzar',`Демо-склад ${seller+1}`]);
    }
    await db.query("INSERT INTO warehouses(id,organization_id,location_id,name) VALUES($1,$2,'malika','Второй склад Atlas · демо')",[demoId('warehouse-extra'),demoId('supplier0')]);
    const specs=[
      ['Apple','iPhone 15','128 GB','8000000','stable'],['Apple','iPhone 15','256 GB','9200000','up'],
      ['Samsung','Galaxy S24','256 GB','7600000','down'],['Samsung','Galaxy A55','128 GB','4200000','declining'],
      ['Xiaomi','Redmi Note 13','128 GB','2400000','shortage'],['Apple','iPhone 16','128 GB','10000000','no_deals'],
      ['Samsung','Galaxy S23','256 GB','6500000','returns'],['Xiaomi','14T','256 GB','5800000','anomaly'],
      ['Honor','200','256 GB','5100000','sparse'],['Realme','12 Pro','256 GB','3800000','unknown_price']
    ];
    const events:Record<string,unknown>[]=[];
    function event(key:string,type:string,sku:number,seller:number,at:number,payload:Record<string,unknown>,aggregate?:string) {
      events.push({event_id:demoId(key),type,organization_id:demoId('supplier'+seller),aggregate_id:aggregate??demoId(key+'-aggregate'),aggregate_version:1,
        sku_id:demoId('sku'+sku),warehouse_id:demoId('warehouse'+seller),occurred_at:new Date(at).toISOString(),recorded_at:new Date(at+1000).toISOString(),
        source_type:'synthetic_fixture',source_id:'seed-v1',external_id:key,verification_level:'synthetic_confirmed',data_origin:'synthetic',payload});
    }
    for(let i=0;i<specs.length;i++) {
      const [brand,model,variant,base,scenario]=specs[i]; const sku=demoId('sku'+i);
      await db.query("INSERT INTO skus(id,code,category,brand,model,variant,condition,region,warranty) VALUES($1,$2,'Смартфоны',$3,$4,$5,'new','Global','12 месяцев, гарантия поставщика')",[sku,`NP-${String(i+1).padStart(3,'0')}`,brand,model,variant]);
      for(let seller=0;seller<5;seller++) {
        const warehouse=demoId('warehouse'+seller); const offer=demoId(`offer${i}-${seller}`);
        let stock=scenario==='shortage'?40:scenario==='unknown_price'?seller===0?1000:0:2500;
        event(`opening-${i}-${seller}`,'InventoryReceived',i,seller,start-3600000,{on_hand_delta:stock,reserved_delta:0,quantity:stock,reason:'Синтетический начальный приход'});
        let last=money(new Decimal(base).plus(seller*25000));
        for(let day=0;day<180;day++) {
          const at=start+day*86400000+5*3600000;
          const drift=scenario==='up'?day*3000:scenario==='down'?-day*2500:0;
          last=money(new Decimal(base).plus(drift).plus(seller*25000).plus(((day+salt)%7-3)*1000));
          event(`offer-${i}-${seller}-${day}`,'OfferPublished',i,seller,at,{offer_id:offer,supplier_id:demoId('supplier'+seller),unit_price:last,min_quantity:1,valid_until:new Date(at+86400000).toISOString(),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final'},offer);
          let q=scenario==='declining'?Math.max(2,9-Math.floor(day/25)):2+(day+seller+salt)%4;
          if(scenario==='shortage') q=day%30===0 && stock>=5?5:0;
          if(scenario==='no_deals'||(scenario==='sparse'&&(day<177||seller>0))) q=0;
          if(scenario==='unknown_price') q=seller===0&&day>=177?[500,200,100][day-177]:0;
          if(scenario==='anomaly') q=seller===0?40:1;
          if(q>stock) q=0;
          if(!q) { event(`reconcile-${i}-${seller}-${day}`,'SourceReconciled',i,seller,at+14400000,{on_hand_delta:0,reserved_delta:0}); continue; }
          const order=demoId(`history-order-${i}-${seller}-${day}`);
          event(`ship-${i}-${seller}-${day}`,'OrderShipped',i,seller,at+3600000,{on_hand_delta:-q,reserved_delta:0,quantity:q},order); stock-=q;
          const price=scenario==='unknown_price'?null:scenario==='anomaly'&&seller===0?money(new Decimal(last).mul(4)):scenario==='declining'?money(base):last;
          event(`receipt-${i}-${seller}-${day}`,'ReceiptAccepted',i,seller,at+7200000,{quantity:q,unit_price:price,order_id:order,supplier_id:demoId('supplier'+seller),
            location:seller<3?'malika':'chilanzar',terms_group:q===1?'1':q<10?'2-9':'10+',currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final',anomaly:scenario==='anomaly'&&seller===0},order);
          if(scenario==='returns'&&day%29===0) {
            event(`return-${i}-${seller}-${day}`,'ReturnAccepted',i,seller,at+10800000,{order_id:order,quantity:1,resalable:true,on_hand_delta:1,reserved_delta:0},order);stock++;
          }
          event(`reconcile-${i}-${seller}-${day}`,'SourceReconciled',i,seller,at+14400000,{on_hand_delta:0,reserved_delta:0});
        }
        await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,$3,now())',[warehouse,sku,stock]);
        await db.query("INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,'synthetic')",[offer,demoId('supplier'+seller),sku,warehouse]);
        await db.query(`INSERT INTO offer_versions(offer_id,version,unit_price,delivery,min_quantity,delivery_days,last_verified_at,valid_until)
          VALUES($1,1,$2,$3,1,1,now(),now()+interval '24 hours')`,[offer,last,money(35000+seller*10000)]);
        // Operational freshness follows the runtime clock; historical events stay anchored and deterministic.
        event(`current-offer-${i}-${seller}`,'OfferPublished',i,seller,Date.now(),{offer_id:offer,supplier_id:demoId('supplier'+seller),unit_price:last,min_quantity:1,valid_until:new Date(Date.now()+86400000).toISOString(),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final'},offer);
        event(`verified-${i}-${seller}`,'SourceReconciled',i,seller,Date.now(),{on_hand_delta:0,reserved_delta:0,verified:true});
      }
      await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,0,now())',[demoId('warehouse-extra'),sku]);
    }
    // Duplicate delivery must not duplicate the source event or analytical fact.
    events.push(events.find(e=>e.type==='ReceiptAccepted')!);
    for(let offset=0;offset<events.length;offset+=1000) {
      await db.query(`INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,recorded_at,source_type,source_id,external_id,verification_level,data_origin,payload)
        SELECT event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,recorded_at,source_type,source_id,external_id,verification_level,data_origin,payload
        FROM jsonb_to_recordset($1::jsonb) AS e(event_id uuid,type text,organization_id uuid,aggregate_id uuid,aggregate_version integer,sku_id uuid,warehouse_id uuid,occurred_at timestamptz,recorded_at timestamptz,source_type text,source_id text,external_id text,verification_level text,data_origin text,payload jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(events.slice(offset,offset+1000))]);
    }
    await db.query('INSERT INTO outbox(event_id) SELECT event_id FROM business_events ON CONFLICT DO NOTHING');
    await db.query("UPDATE database_identity SET seed_version='v1',seed_anchor=$1 WHERE singleton",[anchor]);
    const added=await seedAdditionalDemoProducts(db,demoId);
    console.log(`Демо: ${10+added} SKU, 5 поставщиков, 2 локации; 180 дней истории только для исходных 10 SKU; ${events.length-1} исходных событий`);
  });
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/seed.ts')) {process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;try {await seedDemo();} finally {await pool().end();}}
