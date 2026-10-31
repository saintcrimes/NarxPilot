'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useResource, useMutation, type SessionInfo } from './client';
import { Icon, Loading, Notice } from './ui';
import { Catalog, Compare } from './catalog';
import { AnalyticsScreen } from './analytics-screen';
import { OrdersScreen } from './orders-screen';
import { OrderReceipt } from './order-receipt';
import { SupplierScreen } from './supplier-screen';
import { NotificationsScreen } from './notifications-screen';
import { HelpWidget, HelpBoundary } from './help-widget';
import { AuthPage, Brand, Landing } from './public-pages';
import { PreferenceControls, usePreferences } from './preferences';
const navigation = [['/catalog', 'Каталог товаров', 'grid'], ['/compare', 'Сравнение цен', 'compare'], ['/analytics', 'Аналитика', 'chart'], ['/orders', 'Мои закупки', 'box'], ['/supplier', 'Кабинет поставщика', 'store'], ['/notifications', 'Уведомления', 'bell']];
export type ScreenProps = {
    session: SessionInfo;
    refresh: number;
    onChange: () => void;
};
export function Workspace() {
    const { t } = usePreferences();
    const pathname = usePathname();
    const page = pathname === '/' ? '/catalog' : pathname;
    const router = useRouter();
    const auth = useResource<SessionInfo>('session');
    const [refresh, setRefresh] = useState(0);
    const mutation = useMutation(auth.data?.csrf ?? '', () => { auth.reload(); setRefresh(r => r + 1); });
    const current = auth.data?.profile;
    const props: ScreenProps | undefined = auth.data ? { session: auth.data, refresh, onChange: () => setRefresh(r => r + 1) } : undefined;
    async function enterDemo(target: '/catalog' | '/analytics') {
        const buyer = auth.data?.profiles.find(profile => profile.role === 'buyer');
        if (!buyer || !auth.data?.demo)
            return;
        const result = await mutation.mutate('session/demo', { userId: buyer.user_id });
        if (result)
            router.push(target);
    }
    async function authenticate(mode: 'login' | 'register', body: Record<string, string>) {
        const result = await mutation.mutate('auth/' + mode, body);
        if (result)
            router.push('/catalog');
    }
    const publicProps = { demo: auth.data?.demo ?? false, ready: !!auth.data, busy: mutation.busy, error: auth.error || mutation.error, signedIn: !!current, onDemo: enterDemo };
    const help = auth.data?.chatbot_enabled && <HelpBoundary key={current?.user_id ?? 'guest'}><HelpWidget csrf={auth.data.csrf} provider={auth.data.chatbot_provider} available={auth.data.chatbot_available}/></HelpBoundary>;
    if (pathname === '/')
        return <><Landing {...publicProps}/>{help}</>;
    if (pathname === '/register' || pathname === '/login')
        return <><AuthPage key={pathname} {...publicProps} mode={pathname === '/register' ? 'register' : 'login'} onSubmit={authenticate}/>{help}</>;
    return <div className="app-shell">
    <aside className="sidebar"><Brand compact/>
      <div className="workspace-label">{t("РАБОЧЕЕ ПРОСТРАНСТВО")}</div>
      <nav aria-label={t("Основная навигация")}>{navigation.map(([href, label, icon]) => <Link className={page.startsWith(href) ? 'nav-item active' : 'nav-item'} key={href} href={href}><Icon name={icon}/>{t(label)}{page.startsWith(href) && <span className="active-dot"/>}</Link>)}</nav>
      <div className="sidebar-note"><Icon name="shield"/><b>{t("Цена имеет источник")}</b><p>{t("Предложение, завершённая сделка и прогноз \u2014 отдельные данные.")}</p><span>UZS · Asia/Tashkent</span></div>
      <Link href="/" className="sidebar-footer"><span className="online-dot"/>{t("О платформе NarxPilot")}<Icon name="arrow" size={13}/></Link>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb">{t("Рабочее пространство")}<span>/</span> {t(navigation.find(n => page.startsWith(n[0]))?.[1] ?? t("Заказ"))}</div><div className="account"><PreferenceControls/>
      <span className="avatar">{current?.name[0] ?? t("Н")}</span><label><span className="sr-only">{t("Демонстрационный аккаунт")}</span><select aria-label={t("Демонстрационный аккаунт")} value={current?.user_id ?? ''} disabled={mutation.busy || !auth.data?.demo} onChange={e => void mutation.mutate('session/demo', { userId: e.target.value })}><option value="" disabled>{t("Выберите аккаунт")}</option>{current && !auth.data?.profiles.some(profile => profile.user_id === current.user_id) && <option value={current.user_id}>{current.name} · {current.organization_name}</option>}{auth.data?.profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.name} · {p.role === 'buyer' ? t("покупатель") : p.role === 'supplier' ? t("поставщик") : t("администратор")}</option>)}</select></label>
      {current && <button className="button subtle small" onClick={() => void mutation.mutate('session/logout', {})}>{t("Выйти")}</button>}</div></header>
      <div className="demo-banner">{auth.data?.demo ? <><span>DEMO_MODE</span>{t("Отдельная синтетическая база. Цены, поставщики и сделки вымышленные.")}</> : auth.data ? <><span>LIVE</span>{t("Данные подключённых источников")}</> : <span>{t("Режим данных загружается")}</span>}</div>
      <main>
        {(auth.error || mutation.error) && <Notice error>{auth.error || mutation.error}</Notice>}
        {auth.loading && <Loading />}
        {auth.data && !current && <section className="welcome"><div className="welcome-art"><Icon name="chart" size={60}/><span className="tiny-pill">{t("ФАКТЫ \u2192 РЕШЕНИЯ")}</span></div><p className="eyebrow">{t("ДОБРО ПОЖАЛОВАТЬ В NARXPILOT")}</p><h1>{t("Ваша следующая закупка.")}<br />{t("С понятными условиями.")}</h1><p>{t("Откройте готовый демоаккаунт и пройдите путь от сравнения до приёмки. Или войдите под своим профилем.")}</p><div className="landing-actions">{auth.data.demo && <button className="button primary" disabled={mutation.busy} onClick={() => void enterDemo('/catalog')}>{t("Попробовать демо")}<Icon name="arrow" size={17}/></button>}<Link className="button secondary" href="/login">{t("Войти")}</Link><Link className="text-link" href="/register">{t("Регистрация")}<Icon name="arrow" size={16}/></Link></div></section>}
        {props && current && <div key={current.user_id}>{page === '/catalog' ? <Catalog {...props}/> : page === '/compare' ? <Compare {...props}/> : page === '/analytics' ? <AnalyticsScreen {...props}/> : /^\/orders\/[^/]+\/receipt$/.test(page) ? <OrderReceipt {...props} orderId={page.split('/')[2]}/> : page.startsWith('/orders') ? <OrdersScreen {...props} orderId={page.split('/')[2]}/> : page === '/supplier' ? <SupplierScreen {...props}/> : page === '/notifications' ? <NotificationsScreen {...props}/> : <Notice>{t("Страница не найдена. Откройте каталог.")}</Notice>}</div>}
      </main>
      <footer className="main-footer">NarxPilot <span>{t("Наблюдения платформы, не всего рынка \u00B7 Денежные расчёты на сервере")}</span></footer>
    </div>{help}
  </div>;
}
