import type {PoolClient} from 'pg';
import {Decimal,money} from '../src/domain/money';

// Models and pack sizes identify comparable groceries. All prices, sellers, stock
// and historic transactions in this fixture are synthetic, not market quotations.
export const grocerySpecs=[
  {code:'GR-001',category:'Мука и выпечка',brand:'Makfa',model:'Мука пшеничная высший сорт',variant:'2 кг',unit:'уп.',price:'26000',scenario:'stable'},
  {code:'GR-002',category:'Крупы и рис',brand:'Мистраль',model:'Рис Кубань круглозёрный',variant:'900 г',unit:'уп.',price:'28500',scenario:'up'},
  {code:'GR-003',category:'Крупы и рис',brand:'Увелка',model:'Крупа гречневая',variant:'800 г',unit:'уп.',price:'22500',scenario:'down'},
  {code:'GR-004',category:'Макаронные изделия',brand:'Barilla',model:'Спагетти №5',variant:'500 г',unit:'уп.',price:'24000',scenario:'declining'},
  {code:'GR-005',category:'Масло и соусы',brand:'Олейна',model:'Масло подсолнечное',variant:'1 л',unit:'бут.',price:'22000',scenario:'shortage'},
  {code:'GR-006',category:'Чай, кофе и какао',brand:'Nestlé',model:'Nesquik какао',variant:'250 г',unit:'уп.',price:'35000',scenario:'no_deals'},
  {code:'GR-007',category:'Чай, кофе и какао',brand:'Ahmad Tea',model:'Чай чёрный English Breakfast',variant:'100 г',unit:'уп.',price:'28000',scenario:'returns'},
  {code:'GR-008',category:'Консервы',brand:'Bonduelle',model:'Кукуруза сладкая',variant:'340 г',unit:'бан.',price:'19500',scenario:'anomaly'},
  {code:'GR-009',category:'Масло и соусы',brand:'Heinz',model:'Кетчуп томатный',variant:'350 г',unit:'уп.',price:'21000',scenario:'sparse'},
  {code:'GR-010',category:'Чай, кофе и какао',brand:'Jacobs',model:'Кофе Monarch растворимый',variant:'95 г',unit:'бан.',price:'49000',scenario:'unknown_price'}
] as const;
export const grocerySuppliers=['Baraka Foods','Tashkent Grocery','Savat Optom','Oziq Market','Dasturxon Supply'] as const;

export async function seedGroceryProducts(db:PoolClient,id:(key:string)=>string,anchor:string,salt=0){
  const identity=(await db.query('SELECT data_origin FROM database_identity WHERE singleton')).rows[0];
  if(identity?.data_origin!=='synthetic')throw new Error('Продуктовый seed разрешён только в синтетической базе');
  // This also hides old seed SKUs on a fresh database, where migrations ran first.
  // Their identities, source events, existing orders and stock remain untouched.
  await db.query("UPDATE skus SET catalog_visible=false WHERE code LIKE 'NP-%' AND catalog_visible");
  await db.query("INSERT INTO locations(id,name) VALUES('food_city','Food City · демо'),('sergeli','Сергели') ON CONFLICT DO NOTHING");
  for(let seller=0;seller<grocerySuppliers.length;seller++){
    const key='grocer'+seller,name=grocerySuppliers[seller]+' · демо';
    await db.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'supplier') ON CONFLICT DO NOTHING",[id(key),name]);
    await db.query('INSERT INTO users(id,name,is_demo) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[id('user-'+key),name]);
    await db.query("INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,'supplier') ON CONFLICT DO NOTHING",[id('user-'+key),id(key)]);
    await db.query('INSERT INTO warehouses(id,organization_id,location_id,name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id('grocery-warehouse'+seller),id(key),seller<3?'food_city':'sergeli',`Продуктовый демо-склад ${seller+1}`]);
  }
  const start=new Date(`${anchor}T00:00:00+05:00`).getTime()-180*86400000;
  let added=0;const events:Record<string,unknown>[]=[];
  function event(key:string,type:string,sku:string,seller:number,at:number,payload:Record<string,unknown>,aggregate?:string){
    events.push({event_id:id(key),type,organization_id:id('grocer'+seller),aggregate_id:aggregate??id(key+'-aggregate'),aggregate_version:1,
      sku_id:sku,warehouse_id:id('grocery-warehouse'+seller),occurred_at:new Date(at).toISOString(),recorded_at:new Date(at+1000).toISOString(),
      source_type:'synthetic_fixture',source_id:'seed-groceries-v1',external_id:key,verification_level:'synthetic_confirmed',data_origin:'synthetic',payload});
  }
  for(const item of grocerySpecs){
    const sku=id('grocery-'+item.code);
    const inserted=await db.query(`INSERT INTO skus(id,code,category,brand,model,variant,condition,region,warranty,unit,catalog_visible)
      VALUES($1,$2,$3,$4,$5,$6,'packaged','Маркировка производителя','Срок годности и хранение — по маркировке партии',$7,true)
      ON CONFLICT(id) DO NOTHING RETURNING id`,[sku,item.code,item.category,item.brand,item.model,item.variant,item.unit]);
    // Product, offers and events commit in the caller transaction. A repeated seed
    // must not refill stock, renew offers or overwrite the operator's changes.
    if(!inserted.rowCount)continue;
    added++;
    for(let seller=0;seller<5;seller++){
      const warehouse=id('grocery-warehouse'+seller),supplier=id('grocer'+seller),offer=id(`grocery-offer-${item.code}-${seller}`);
      let stock=item.scenario==='shortage'?50:item.scenario==='unknown_price'?seller===0?1500:0:3000;
      event(`grocery-opening-${item.code}-${seller}`,'InventoryReceived',sku,seller,start-3600000,{on_hand_delta:stock,reserved_delta:0,quantity:stock,unit:item.unit,reason:'Синтетический начальный приход упаковок'});
      let last=money(new Decimal(item.price).plus(new Decimal(seller).mul('200')));
      for(let day=0;day<180;day++){
        const at=start+day*86400000+5*3600000;
        const drift=item.scenario==='up'?new Decimal(day).mul('12'):item.scenario==='down'?new Decimal(day).mul('-10'):new Decimal(0);
        last=money(new Decimal(item.price).plus(drift).plus(new Decimal(seller).mul('200')).plus(new Decimal((day+salt)%7-3).mul('25')));
        event(`grocery-offer-${item.code}-${seller}-${day}`,'OfferPublished',sku,seller,at,{offer_id:offer,supplier_id:supplier,unit_price:last,min_quantity:1,valid_until:new Date(at+86400000).toISOString(),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final',unit:item.unit},offer);
        let q=item.scenario==='declining'?Math.max(2,9-Math.floor(day/25)):2+(day+seller+salt)%6;
        if(item.scenario==='shortage')q=day%30===0&&stock>=5?5:0;
        if(item.scenario==='no_deals'||item.scenario==='sparse'&&(day<177||seller>0))q=0;
        if(item.scenario==='unknown_price')q=seller===0&&day>=177?[500,200,100][day-177]:0;
        if(item.scenario==='anomaly')q=seller===0?20:2;
        if(q>stock)q=0;
        if(!q){event(`grocery-reconcile-${item.code}-${seller}-${day}`,'SourceReconciled',sku,seller,at+14400000,{on_hand_delta:0,reserved_delta:0});continue;}
        const order=id(`grocery-history-order-${item.code}-${seller}-${day}`);
        event(`grocery-ship-${item.code}-${seller}-${day}`,'OrderShipped',sku,seller,at+3600000,{on_hand_delta:-q,reserved_delta:0,quantity:q,unit:item.unit},order);stock-=q;
        const price=item.scenario==='unknown_price'?null:item.scenario==='anomaly'&&seller===0?money(new Decimal(last).mul(4)):item.scenario==='declining'?money(item.price):last;
        event(`grocery-receipt-${item.code}-${seller}-${day}`,'ReceiptAccepted',sku,seller,at+7200000,{quantity:q,unit_price:price,order_id:order,supplier_id:supplier,
          location:seller<3?'food_city':'sergeli',terms_group:q===1?'1':q<10?'2-9':'10+',currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final',unit:item.unit,anomaly:item.scenario==='anomaly'&&seller===0},order);
        if(item.scenario==='returns'&&day%29===0){event(`grocery-return-${item.code}-${seller}-${day}`,'ReturnAccepted',sku,seller,at+10800000,{order_id:order,quantity:1,resalable:true,on_hand_delta:1,reserved_delta:0,unit:item.unit},order);stock++;}
        event(`grocery-reconcile-${item.code}-${seller}-${day}`,'SourceReconciled',sku,seller,at+14400000,{on_hand_delta:0,reserved_delta:0});
      }
      await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,$3,now())',[warehouse,sku,stock]);
      await db.query("INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,'synthetic')",[offer,supplier,sku,warehouse]);
      await db.query(`INSERT INTO offer_versions(offer_id,version,unit_price,delivery,min_quantity,delivery_days,last_verified_at,valid_until)
        VALUES($1,1,$2,$3,1,1,now(),now()+interval '24 hours')`,[offer,last,money(new Decimal('15000').plus(new Decimal(seller).mul('3000')))]);
      const now=Date.now();
      event(`grocery-current-offer-${item.code}-${seller}`,'OfferPublished',sku,seller,now,{offer_id:offer,supplier_id:supplier,unit_price:last,min_quantity:1,valid_until:new Date(now+86400000).toISOString(),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final',unit:item.unit},offer);
      event(`grocery-verified-${item.code}-${seller}`,'SourceReconciled',sku,seller,now,{on_hand_delta:0,reserved_delta:0,verified:true});
    }
  }
  for(let offset=0;offset<events.length;offset+=1000){
    await db.query(`INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,recorded_at,source_type,source_id,external_id,verification_level,data_origin,payload)
      SELECT event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,recorded_at,source_type,source_id,external_id,verification_level,data_origin,payload
      FROM jsonb_to_recordset($1::jsonb) AS e(event_id uuid,type text,organization_id uuid,aggregate_id uuid,aggregate_version integer,sku_id uuid,warehouse_id uuid,occurred_at timestamptz,recorded_at timestamptz,source_type text,source_id text,external_id text,verification_level text,data_origin text,payload jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(events.slice(offset,offset+1000))]);
  }
  await db.query("INSERT INTO outbox(event_id) SELECT event_id FROM business_events WHERE source_id='seed-groceries-v1' ON CONFLICT DO NOTHING");
  return added;
}
