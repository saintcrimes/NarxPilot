'use client';
import {usePreferences} from './preferences';
import Link from 'next/link';
import type { ScreenProps } from './workspace';
import { useResource,useMutation,dateTime } from './client';
import { Heading,Empty,Notice,Loading,Icon } from './ui';
type Favorite={id:string;sku_id:string;model:string;variant:string;location_id:string;threshold:string|null;enabled:boolean};
type Notification={id:string;title:string;body:string;order_id:string|null;read_at:string|null;created_at:string};
export function NotificationsScreen({session,refresh,onChange}:ScreenProps) {
  const {t}=usePreferences();
  const messages=useResource<Notification[]>('notifications',refresh,true);const favorites=useResource<Favorite[]>('favorites',refresh);const mutation=useMutation(session.csrf,onChange);
  return <><Heading eyebrow={t("СОХРАНЁННЫЕ ТОВАРЫ · ИЗМЕНЕНИЯ ЗАКУПОК")} title={t("Уведомления и избранное")} description={t("Сообщения остаются внутри приложения. Порог цены не создаёт заказ автоматически.")}/>
    {(mutation.error||messages.error||favorites.error)&&<Notice error>{mutation.error||messages.error||favorites.error}</Notice>}
    <div className="two-columns"><section className="panel"><h2><Icon name="bell"/>{t("Уведомления")}</h2>{messages.loading&&<Loading/>}{messages.data?.length===0&&<Empty title={t("Новых событий нет")} description={t("Подтверждение условий и другие изменения заказа появятся здесь.")}/>}{messages.data?.map(n=><article className={'notification '+(n.read_at?'read':'')} key={n.id}><div className="section-top"><b>{n.title}</b><small>{dateTime(n.created_at)}</small></div><p>{n.body}</p><div className="row">{n.order_id&&<Link className="text-link" href={'/orders/'+n.order_id}>{t("Открыть заказ")}</Link>}{!n.read_at&&<button className="button subtle small" disabled={mutation.busy} onClick={()=>void mutation.mutate('notifications/read',{id:n.id})}>{t("Прочитано")}</button>}</div></article>)}</section>
    <section className="panel"><h2>{t("Избранное и пороги")}</h2>{favorites.data?.length===0&&<Empty title={t("Сохраните нужный SKU")} description={t("Нажмите звезду у товара в каталоге, затем задайте порог опубликованной цены.")}/>}{favorites.data?.map(f=><article className="favorite" key={f.id}><Link href={'/analytics?sku='+f.sku_id}><h3>{f.model} · {f.variant}</h3></Link><form className="inline-form" key={f.id+f.threshold+f.enabled} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void mutation.mutate('favorites',{skuId:f.sku_id,location:f.location_id,threshold:String(form.get('threshold'))||null,enabled:form.get('enabled')==='on'});}}><label className="field"><span>{t("Порог цены единицы, UZS")}</span><input name="threshold" inputMode="decimal" placeholder={t("Без порога")} defaultValue={f.threshold??''}/></label><label className="checkbox"><input name="enabled" type="checkbox" defaultChecked={f.enabled}/>{t("Включено")}</label><button className="button secondary small" disabled={mutation.busy}>{t("Сохранить")}</button></form><p className="small muted">{t("Уведомление при новой публикации предложения. Доставка и минимальная партия проверяются отдельно.")}</p></article>)}</section></div></>;
}
