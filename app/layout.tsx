import type { Metadata,Viewport } from 'next';
import Script from 'next/script';
import { TelegramMiniApp } from '@/components/telegram-mini-app';
import './globals.css';
export const metadata:Metadata={title:'NarxPilot — уверенность в каждой закупке',description:'B2B-закупки: сравнение полной стоимости, согласование условий и проверяемая аналитика наблюдаемых цен.',icons:{icon:'/brand/icon.png',apple:'/brand/icon.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#0d0e1c'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="ru"><head><Script src="https://telegram.org/js/telegram-web-app.js?64" strategy="beforeInteractive"/></head><body><TelegramMiniApp/>{children}</body></html>;
}
