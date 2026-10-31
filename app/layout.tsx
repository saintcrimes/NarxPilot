import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'NarxPilot — закупки на основе фактов',description:'B2B-закупки смартфонов и проверяемая аналитика наблюдаемых цен'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="ru"><body>{children}</body></html>;
}
