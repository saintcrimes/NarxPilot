import 'dotenv/config';
import { requireThat } from '../domain/errors';
export const isDemo = () => process.env.DEMO_MODE === 'true';
export const origin = () => isDemo() ? 'synthetic' : 'live';
export function validateDatabase(url: string) {
  const name = new URL(url).pathname.slice(1);
  const demoName = /^narxpilot_(demo|test)(_[a-z0-9]+)?$/.test(name);
  requireThat(isDemo() === demoName, 'DATABASE_MODE_MISMATCH', 'Режим и имя базы не совпадают', 503);
  return name;
}
export const reservationMinutes = () => Number(process.env.RESERVATION_TTL_MINUTES || 15);
