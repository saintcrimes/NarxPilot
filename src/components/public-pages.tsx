'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, type FormEvent } from 'react';
import { Icon, Notice } from './ui';
import { PreferenceControls, usePreferences } from './preferences';
export function Brand({ compact = false }: {
    compact?: boolean;
}) {
    const { t } = usePreferences();
    return <Link href="/" className={'brand identity' + (compact ? ' compact' : '')} aria-label={t("NarxPilot \u2014 главная")}><Image src="/brand/icon.png" width={46} height={46} alt="" priority/><span>Narx<span className="brand-accent">Pilot</span><small>{t("ЗАКУПКИ НА ОСНОВЕ ФАКТОВ")}</small></span></Link>;
}
type PublicProps = {
    demo: boolean;
    ready: boolean;
    busy: boolean;
    error?: string;
    signedIn: boolean;
    onDemo: (target: '/catalog' | '/analytics') => Promise<void>;
};
export function PublicHeader({ signedIn }: {
    signedIn: boolean;
}) {
    const { t } = usePreferences();
    return <header className="public-header"><Brand /><nav aria-label={t("Навигация по продукту")}><Link href="/#how-it-works">{t("Как это работает")}</Link><Link href="/#business-model">{t("Для бизнеса")}</Link></nav><div className="public-header-actions"><PreferenceControls/>{signedIn ? <Link className="button primary" href="/catalog">{t("В кабинет")}<Icon name="arrow" size={16}/></Link> : <><Link className="public-login" href="/login">{t("Войти")}</Link><Link className="button primary" href="/register">{t("Регистрация")}<Icon name="arrow" size={16}/></Link></>}</div></header>;
}
export function PublicMode({ demo }: {
    demo: boolean;
}) {
    const { t } = usePreferences();
    return demo ? <div className="public-demo-note"><span>DEMO_MODE</span>{t("Вы в демоверсии: товары, поставщики и сделки синтетические.")}</div> : null;
}
export function Landing(props: PublicProps) {
    const { t } = usePreferences();
    const main = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!main.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window))
            return;
        const sections = main.current.querySelectorAll('.landing-features,.landing-section,.business-section,.landing-final');
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries)
                if (entry.isIntersecting) {
                    entry.target.setAttribute('data-motion-visible', 'true');
                    observer.unobserve(entry.target);
                }
        }, { threshold: 0.08, rootMargin: '0px 0px -28px 0px' });
        for (const section of sections) {
            section.setAttribute('data-motion-reveal', '');
            observer.observe(section);
        }
        return () => observer.disconnect();
    }, []);
    return <div className="public-site"><PublicHeader signedIn={props.signedIn}/><PublicMode demo={props.demo}/><main className="landing-main" ref={main}>
    <section className="landing-hero"><div className="landing-copy"><div className="landing-kicker"><span className="violet-dot"/>{t("B2B-закупки \u00B7 Узбекистан")}</div><h1>{t("Уверенность")}<br />{t("в каждой")}<span>{t("закупке.")}</span></h1><p className="landing-lead">{t("Находите точный товар, сравнивайте стоимость с доставкой и ведите закупку до приёмки. Решения \u2014 на основе наблюдаемых цен и подтверждённых сделок.")}</p><div className="landing-actions">{props.demo ? <><button className="button primary large" disabled={!props.ready || props.busy} onClick={() => void props.onDemo('/catalog')}>{props.busy ? t("Открываем кабинет\u2026") : t("Попробовать демо")}<Icon name="arrow"/></button><button className="button glass large" disabled={!props.ready || props.busy} onClick={() => void props.onDemo('/analytics')}><Icon name="chart"/>{t("Посмотреть аналитику")}</button></> : <Link className="button primary large" href={props.signedIn ? '/catalog' : '/register'}>{props.signedIn ? t("Открыть каталог") : t("Создать аккаунт")}<Icon name="arrow"/></Link>}</div><p className="landing-caption">{props.demo ? t("Готовый аккаунт покупателя. Один клик \u2014 и вы внутри.") : t("Единое рабочее пространство покупателя и поставщика.")}</p>{props.error && <Notice error>{props.error}</Notice>}<div className="landing-trust"><span><Icon name="check" size={15}/>{t("Полная стоимость")}</span><span><Icon name="check" size={15}/>{t("История событий")}</span><span><Icon name="check" size={15}/>{t("Проверяемые данные")}</span></div></div>
      <div className="hero-orbit" aria-label={t("От точного товара к подтверждённой сделке")}><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-glow"/><Image className="hero-brand-icon" src="/brand/icon.png" width={250} height={250} alt={t("Логотип NarxPilot")} priority/><div className="orbit-card orbit-top"><span className="orbit-icon"><Icon name="search"/></span><div><small>{t("01 / НАЙДИТЕ")}</small><strong>{t("Точный товар")}</strong><span>{t("Модель \u00B7 память \u00B7 регион")}</span></div><span className="orbit-check"><Icon name="check" size={14}/></span></div><div className="orbit-card orbit-right"><span className="orbit-icon"><Icon name="compare"/></span><div><small>{t("02 / СРАВНИТЕ")}</small><strong>{t("Полную стоимость")}</strong><span>{t("Товар + доставка + сборы")}</span></div></div><div className="orbit-card orbit-bottom"><span className="orbit-icon"><Icon name="shield"/></span><div><small>{t("03 / ПОДТВЕРДИТЕ")}</small><strong>{t("Каждый этап сделки")}</strong><span>{t("От заявки до приёмки")}</span></div><span className="orbit-check"><Icon name="check" size={14}/></span></div><span className="orbit-caption">{t("Один понятный путь закупки")}</span></div>
    </section>
    <section className="landing-features" aria-label={t("Возможности платформы")}>{[
            ['compare', t("Сравнение без догадок"), t("Одинаковые SKU и итоговая стоимость партии. Доставка и сборы входят в расчёт.")],
            ['box', t("Весь путь закупки"), t("Заявка, котировка, согласие, резерв, отгрузка и приёмка \u2014 с сохранением истории.")],
            ['chart', t("Аналитика с источником"), t("Предложения и завершённые сделки показаны раздельно. Отсутствующие данные не превращаются в ноль.")]
        ].map(([icon, title, description]) => <article key={title}><span className="feature-icon"><Icon name={icon} size={24}/></span><h2>{title}</h2><p>{description}</p></article>)}</section>
    <section id="how-it-works" className="landing-section"><div className="section-intro"><p className="eyebrow">{t("ОТ ПОИСКА ДО РЕЗУЛЬТАТА")}</p><h2>{t("Условия согласованы.")}<br /><span>{t("Следующий шаг понятен.")}</span></h2><p>{t("Покупатель принимает подтверждённую котировку. Поставщик резервирует товар и отмечает отгрузку. Приёмка обновляет аналитику фактических сделок.")}</p></div><div className="journey-steps">{[['01', t("Найдите и сравните"), t("Выберите точный SKU и сравните предложения с учётом количества и доставки.")], ['02', t("Согласуйте и зарезервируйте"), t("Отправьте заявку, получите котировку и подтвердите условия перед резервом.")], ['03', t("Примите и оцените"), t("Зафиксируйте приёмку. Её события попадут в аналитику подтверждённых цен.")]].map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>
    <section id="business-model" className="business-section"><div><p className="eyebrow">{t("ПОКУПАТЕЛЯМ И ПОСТАВЩИКАМ")}</p><h2>{t("Рабочее пространство")}<br />{t("для вашей команды.")}</h2><p>{t("Покупателям \u2014 прозрачное сравнение и контроль закупок. Поставщикам \u2014 управление предложениями, запасами и входящими заявками.")}</p><Link className="button primary" href="/register">{t("Создать аккаунт")}<Icon name="arrow" size={17}/></Link></div><div className="business-model-card"><span className="model-label">{t("ПЛАНИРУЕМАЯ БИЗНЕС-МОДЕЛЬ")}</span><h3>{t("Подписка для бизнеса")}</h3><p>{t("Планируется платный доступ к инструментам поставщика и расширенной аналитике. Тарифы пока не установлены.")}</p><div><Icon name="check" size={17}/><span>{t("Демоверсия доступна бесплатно")}</span></div><small>{t("Оплата и реальные платежи не подключены.")}</small></div></section>
    <section className="landing-final"><p className="eyebrow">{t("ПОПРОБУЙТЕ САМИ")}</p><h2>{t("Меньше неизвестного.")}<br />{t("Больше оснований для решения.")}</h2><div className="landing-actions">{props.demo && <button className="button primary large" disabled={!props.ready || props.busy} onClick={() => void props.onDemo('/catalog')}>{t("Открыть демоверсию")}<Icon name="arrow"/></button>}<Link className="button glass large" href="/register">{t("Зарегистрироваться")}</Link></div></section>
  </main><footer className="public-footer"><Brand /><span>{t("Наблюдения платформы, а не всего рынка.")}<br />NarxPilot · UZS · Asia/Tashkent</span><Link href="/login">{t("Войти в кабинет")}<Icon name="arrow" size={15}/></Link></footer></div>;
}
export function AuthPage(props: PublicProps & {
    mode: 'login' | 'register';
    onSubmit: (mode: 'login' | 'register', body: Record<string, string>) => Promise<void>;
}) {
    const { t } = usePreferences();
    const registration = props.mode === 'register';
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        await props.onSubmit(props.mode, Object.fromEntries(Array.from(values.entries()).map(([key, value]) => [key, String(value)])));
    }
    return <div className="public-site auth-site"><PublicHeader signedIn={props.signedIn}/><PublicMode demo={props.demo}/><main className="auth-main"><section className="auth-story"><p className="eyebrow">{t("ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО")}</p><h1>{t("Всё для закупки.")}<br /><span>{t("В одном месте.")}</span></h1><p>{t("Сравнение, согласование условий и аналитика с понятным источником данных.")}</p><div className="auth-story-image"><Image src="/brand/wordmark.png" width={790} height={210} alt="NarxPilot" priority/></div><ul><li><Icon name="check"/>{t("Точные товары и полная стоимость")}</li><li><Icon name="check"/>{t("Раздельные кабинеты покупателя и поставщика")}</li><li><Icon name="check"/>{t("История действий по каждой закупке")}</li></ul>{props.demo && <div className="auth-demo-card"><div><strong>{t("Сначала посмотреть?")}</strong><p>{t("Демоаккаунт уже готов. Заполнять форму не нужно.")}</p></div><button className="button glass" disabled={!props.ready || props.busy} onClick={() => void props.onDemo('/catalog')}>{t("Войти в демо")}<Icon name="arrow" size={17}/></button></div>}</section><section className="auth-card"><span className="auth-card-icon"><Icon name={registration ? 'store' : 'shield'} size={23}/></span><h2>{registration ? t("Создайте аккаунт") : t("С возвращением")}</h2><p>{registration ? t("Начните с профиля вашей организации.") : t("Войдите в рабочее пространство NarxPilot.")}</p><form onSubmit={event => void submit(event)}>{registration && <><label className="field"><span>{t("Ваше имя")}</span><input name="name" autoComplete="name" placeholder={t("Как к вам обращаться")} minLength={2} maxLength={100} required/></label><label className="field"><span>{t("Организация")}</span><input name="organizationName" autoComplete="organization" placeholder={t("Название компании")} minLength={2} maxLength={150} required/></label><label className="field"><span>{t("Я планирую")}</span><select name="role" defaultValue="buyer"><option value="buyer">{t("Покупать товары")}</option><option value="supplier">{t("Поставлять товары")}</option></select></label></>}<label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" placeholder="you@company.uz" maxLength={254} required/></label><label className="field"><span>{t("Пароль")}</span><input name="password" type="password" autoComplete={registration ? 'new-password' : 'current-password'} placeholder={registration ? t("Не менее 10 символов") : t("Ваш пароль")} minLength={registration ? 10 : 1} maxLength={128} required/></label>{props.error && <Notice error>{props.error}</Notice>}<button className="button primary auth-submit" disabled={!props.ready || props.busy} type="submit">{props.busy ? t("Подождите\u2026") : registration ? t("Создать аккаунт") : t("Войти")}<Icon name="arrow" size={18}/></button></form>{props.demo && <p className="auth-environment">{t("Регистрация создаёт ваш профиль в демосреде. Товарные данные здесь синтетические.")}</p>}<div className="auth-switch">{registration ? t("Уже есть аккаунт?") : t("Ещё нет аккаунта?")} <Link href={registration ? '/login' : '/register'}>{registration ? t("Войти") : t("Зарегистрироваться")}</Link></div></section></main><footer className="auth-footer">{t("NarxPilot \u00B7 Закупки на основе фактов")}</footer></div>;
}
