import type { PoolClient } from 'pg';
import { Decimal,money } from '../src/domain/money';

// Product specifications identify real models; prices and stock below are synthetic fixtures.
// No past sales or price history is created for these newly listed products.
const additions=[
  {index:10,category:'Компьютеры',brand:'Apple',model:'MacBook Air 13 M3',variant:'16 GB RAM / 256 GB SSD',price:'12500000',stock:24},
  {index:11,category:'Принтеры',brand:'HP',model:'LaserJet M110w',variant:'A4 / монохромный лазерный / Wi-Fi',price:'2100000',stock:40},
  {index:12,category:'Бытовая техника',brand:'Samsung',model:'MS23K3513AK',variant:'23 л',price:'1500000',stock:32}
] as const;

export async function seedAdditionalDemoProducts(db:PoolClient,id:(name:string)=>string){
  const identity=(await db.query('SELECT data_origin FROM database_identity WHERE singleton')).rows[0];
  if(identity?.data_origin!=='synthetic')throw new Error('Расширение каталога разрешено только в синтетической базе');
  let added=0;
  for(const item of additions){
    const sku=id('sku'+item.index);
    const inserted=await db.query(`INSERT INTO skus(id,code,category,brand,model,variant,condition,region,warranty)
      VALUES($1,$2,$3,$4,$5,$6,'new','Global','12 месяцев, гарантия поставщика') ON CONFLICT(id) DO NOTHING RETURNING id`,
      [sku,`NP-${String(item.index+1).padStart(3,'0')}`,item.category,item.brand,item.model,item.variant]);
    // Each product and its offers/events commit together. Existing stock and offer versions stay intact.
    if(!inserted.rowCount)continue;
    added++;
    for(let seller=0;seller<5;seller++){
      const warehouse=id('warehouse'+seller),supplier=id('supplier'+seller),offer=id(`offer${item.index}-${seller}`);
      const stock=item.stock+seller*4,price=money(new Decimal(item.price).plus(new Decimal(seller).mul('25000')));
      const delivery=money(new Decimal('45000').plus(new Decimal(seller).mul('10000')));
      await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,$3,now())',[warehouse,sku,stock]);
      await db.query("INSERT INTO offers(id,supplier_id,sku_id,warehouse_id,data_origin) VALUES($1,$2,$3,$4,'synthetic')",[offer,supplier,sku,warehouse]);
      const version=(await db.query(`INSERT INTO offer_versions(offer_id,version,unit_price,delivery,min_quantity,delivery_days,last_verified_at,valid_until)
        VALUES($1,1,$2,$3,1,1,now(),now()+interval '24 hours') RETURNING valid_until`,[offer,price,delivery])).rows[0];
      const events:[string,string,Record<string,unknown>][]=[
        ['opening','InventoryReceived',{on_hand_delta:stock,reserved_delta:0,quantity:stock,reason:'Синтетический начальный приход нового товара'}],
        ['offer','OfferPublished',{offer_id:offer,supplier_id:supplier,unit_price:price,min_quantity:1,valid_until:version.valid_until.toISOString(),currency:'UZS',payment_terms:'bank_transfer',price_basis:'seller_final'}],
        ['verified','SourceReconciled',{on_hand_delta:0,reserved_delta:0,verified:true}]
      ];
      for(const [kind,type,payload]of events){
        const externalId=`catalog-v2-${item.index}-${seller}-${kind}`,eventId=id(externalId);
        await db.query(`INSERT INTO business_events(event_id,type,organization_id,aggregate_id,aggregate_version,sku_id,warehouse_id,occurred_at,recorded_at,source_type,source_id,external_id,verification_level,data_origin,payload)
          VALUES($1,$2,$3,$4,1,$5,$6,now(),now(),'synthetic_fixture','seed-catalog-v2',$7,'synthetic_confirmed','synthetic',$8) ON CONFLICT DO NOTHING`,
          [eventId,type,supplier,kind==='offer'?offer:warehouse,sku,warehouse,externalId,payload]);
        await db.query('INSERT INTO outbox(event_id) VALUES($1) ON CONFLICT DO NOTHING',[eventId]);
      }
    }
    await db.query('INSERT INTO inventory_balances(warehouse_id,sku_id,on_hand,verified_at) VALUES($1,$2,0,now())',[id('warehouse-extra'),sku]);
  }
  return added;
}
