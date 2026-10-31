import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'NarxPilot — уверенность в каждой закупке',description:'B2B-закупки: сравнение полной стоимости, согласование условий и проверяемая аналитика наблюдаемых цен.',icons:{icon:'/brand/icon.png',apple:'/brand/icon.png'}};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="ru"><body>{children}</body></html>;
}
