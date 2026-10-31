'use client';
import { useEffect } from 'react';
import { usePathname,useRouter } from 'next/navigation';

type TelegramWebApp = {
  platform: string;
  ready: () => void;
  expand: () => void;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  BackButton: {show:()=>void;hide:()=>void;onClick:(handler:()=>void)=>void;offClick:(handler:()=>void)=>void};
};
function webApp() {
  const app = (window as Window & {Telegram?:{WebApp?:TelegramWebApp}}).Telegram?.WebApp;
  // SDK presence alone does not mean the page was opened inside Telegram.
  return app && app.platform && app.platform !== 'unknown' ? app : undefined;
}
function optionalBridge(action:()=>void) {
  try { action(); } catch { /* A missing client capability must not break the website. */ }
}
/** Presentation bridge only. Telegram launch data never authenticates a NarxPilot user. */
export function TelegramMiniApp() {
  const pathname=usePathname();const router=useRouter();
  useEffect(()=>{
    const app=webApp();if(!app)return;
    document.documentElement.classList.add('telegram-mini-app');
    optionalBridge(()=>app.ready());
    optionalBridge(()=>app.expand());
    optionalBridge(()=>{if(app.isVersionAtLeast('6.1'))app.setBackgroundColor('#101222');});
    optionalBridge(()=>{if(app.isVersionAtLeast('6.9'))app.setHeaderColor('#0d0e1c');});
    optionalBridge(()=>{if(app.isVersionAtLeast('7.10'))app.setBottomBarColor?.('#0d0e1c');});
    return ()=>document.documentElement.classList.remove('telegram-mini-app');
  },[]);
  useEffect(()=>{
    const app=webApp();if(!app)return;
    let supported=false;optionalBridge(()=>{supported=app.isVersionAtLeast('6.1');});
    if(!supported)return;
    // Use an explicit in-app parent, never browser history that may leave the Mini App.
    const back=()=>router.push(pathname.startsWith('/orders/')?'/orders':pathname==='/catalog'?'/' : pathname==='/login'||pathname==='/register'?'/' : '/catalog');
    optionalBridge(()=>{if(pathname==='/')app.BackButton.hide();else app.BackButton.show();});
    optionalBridge(()=>app.BackButton.onClick(back));
    return ()=>{optionalBridge(()=>app.BackButton.offClick(back));optionalBridge(()=>app.BackButton.hide());};
  },[pathname,router]);
  return null;
}
