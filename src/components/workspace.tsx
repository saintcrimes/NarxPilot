'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useResource,useMutation,type SessionInfo } from './client';
import { Icon,Loading,Notice } from './ui';
import { Catalog,Compare } from './catalog';
import { AnalyticsScreen } from './analytics-screen';
import { OrdersScreen } from './orders-screen';
import { SupplierScreen } from './supplier-screen';
import { NotificationsScreen } from './notifications-screen';
import { HelpWidget,HelpBoundary } from './help-widget';
const navigation=[['/catalog','Каталог товаров','grid'],['/compare','Сравнение цен','compare'],['/analytics','Аналитика','chart'],['/orders','Мои закупки','box'],['/supplier','Кабинет поставщика','store'],['/notifications','Уведомления','bell']];
export type ScreenProps={session:SessionInfo;refresh:number;onChange:()=>void};
export function Workspace() {
  const pathname=usePathname();const page=pathname==='/'?'/catalog':pathname;
  const auth=useResource<SessionInfo>('session');const [refresh,setRefresh]=useState(0);
  const mutation=useMutation(auth.data?.csrf??'',()=>{auth.reload();setRefresh(r=>r+1);});
  const current=auth.data?.profile;
  const props:ScreenProps|undefined=auth.data?{session:auth.data,refresh,onChange:()=>setRefresh(r=>r+1)}:undefined;
  return <div className="app-shell">
    <aside className="sidebar"><Link href="/catalog" className="brand"><span className="brand-icon">N<span/></span><span>NarxPilot<small>ЗАКУПКИ НА ОСНОВЕ ФАКТОВ</small></span></Link>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">{navigation.map(([href,label,icon])=><Link className={page.startsWith(href)?'nav-item active':'nav-item'} key={href} href={href}><Icon name={icon}/>{label}{page.startsWith(href)&&<span className="active-dot"/>}</Link>)}</nav>
      <div className="sidebar-note"><Icon name="shield"/><b>Цена имеет источник</b><p>Предложение, завершённая сделка и прогноз — отдельные данные.</p><span>UZS · Asia/Tashkent</span></div>
      <div className="sidebar-footer"><span className="online-dot"/>Локальный прототип · v0.1</div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb">Рабочее пространство <span>/</span> {navigation.find(n=>page.startsWith(n[0]))?.[1]??'Заказ'}</div><div className="account">
      <span className="avatar">{current?.name[0]??'Н'}</span><label><span className="sr-only">Демонстрационный аккаунт</span><select aria-label="Демонстрационный аккаунт" value={current?.user_id??''} disabled={mutation.busy||!auth.data?.demo} onChange={e=>void mutation.mutate('session/demo',{userId:e.target.value})}><option value="" disabled>Выберите аккаунт</option>{auth.data?.profiles.map(p=><option key={p.user_id} value={p.user_id}>{p.name} · {p.role==='buyer'?'покупатель':p.role==='supplier'?'поставщик':'администратор'}</option>)}</select></label>
      {current&&<button className="button subtle small" onClick={()=>void mutation.mutate('session/logout',{})}>Выйти</button>}</div></header>
      <div className="demo-banner">{auth.data?.demo?<><span>DEMO_MODE</span> Отдельная синтетическая база. Цены, поставщики и сделки вымышленные.</>:auth.data?<><span>LIVE</span> Данные подключённых источников</>:<span>Режим данных загружается</span>}</div>
      <main>
        {(auth.error||mutation.error)&&<Notice error>{auth.error||mutation.error}</Notice>}
        {auth.loading&&<Loading/>}
        {auth.data&&!current&&<section className="welcome"><div className="welcome-art"><Icon name="chart" size={80}/><span className="tiny-pill">ФАКТЫ → РЕШЕНИЯ</span></div><p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ В NARXPILOT</p><h1>Каждая закупка<br/>начинается с точного сравнения.</h1><p>Выберите демонстрационный аккаунт сверху, чтобы найти товар, согласовать условия и пройти путь до приёмки.</p><div className="welcome-steps"><span>01 · Сравните</span><span>02 · Подтвердите</span><span>03 · Примите</span></div></section>}
        {props&&current&&<div key={current.user_id}>{page==='/catalog'?<Catalog {...props}/>:page==='/compare'?<Compare {...props}/>:page==='/analytics'?<AnalyticsScreen {...props}/>:page.startsWith('/orders')?<OrdersScreen {...props} orderId={page.split('/')[2]}/>:page==='/supplier'?<SupplierScreen {...props}/>:page==='/notifications'?<NotificationsScreen {...props}/>:<Notice>Страница не найдена. Откройте каталог.</Notice>}</div>}
      </main>
      <footer className="main-footer">NarxPilot <span>Наблюдения платформы, не всего рынка · Денежные расчёты на сервере</span></footer>
    </div>
    {auth.data?.chatbot_enabled&&<HelpBoundary key={current?.user_id??'guest'}><HelpWidget csrf={auth.data.csrf} provider={auth.data.chatbot_provider} available={auth.data.chatbot_available}/></HelpBoundary>}
  </div>;
}
