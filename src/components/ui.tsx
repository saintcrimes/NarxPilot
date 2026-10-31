import Link from 'next/link';
export function Icon({name,size=20}:{name:string;size?:number}) {
  const paths:Record<string,React.ReactNode>={
    grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    chart:<><path d="M4 3v17h17M7 14l4-5 4 3 6-8"/></>,
    compare:<><path d="M5 7h15m-4-4 4 4-4 4M19 17H4m4-4-4 4 4 4"/></>,
    box:<><path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11M7 5l10 4"/></>,
    store:<><path d="M3 10h18l-2-6H5l-2 6Zm2 0v10h14V10M9 20v-6h6v6"/></>,
    bell:<><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4"/></>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
    phone:<><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/></>,
    check:<path d="m5 12 4 4L20 5"/>,
    help:<><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/></>,
    shield:<><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 11 3 3 5-6"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.grid}</svg>;
}
export function Heading({eyebrow,title,description,children}:{eyebrow:string;title:string;description:string;children?:React.ReactNode}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{children}</div>;
}
export function Notice({children,error=false}:{children:React.ReactNode;error?:boolean}) {return <div className={error?'notice error':'notice'} role={error?'alert':'status'}>{children}</div>;}
export function Empty({title,description}:{title:string;description:string}) {return <div className="empty"><Icon name="box" size={32}/><h3>{title}</h3><p>{description}</p></div>;}
export function Loading() {return <div className="loading" role="status"><span className="spinner"/>Загружаем данные из базы…</div>;}
export function SectionLink({href,children}:{href:string;children:React.ReactNode}) {return <Link href={href} className="text-link">{children}<Icon name="arrow" size={16}/></Link>;}
