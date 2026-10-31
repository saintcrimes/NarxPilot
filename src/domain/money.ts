import Decimal from 'decimal.js';
Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export const money = (value: Decimal.Value) => new Decimal(value).toFixed(2);
export function total(unitPrice: string, quantity: number, delivery: string | null, fees = '0.00') {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Некорректное количество');
  if (delivery === null) return null;
  return money(new Decimal(unitPrice).mul(quantity).plus(delivery).plus(fees));
}
export function median(values: string[]): string | null {
  if (!values.length) return null;
  const sorted = values.map(v => new Decimal(v)).sort((a,b) => a.comparedTo(b));
  const n = sorted.length;
  return money(n % 2 ? sorted[Math.floor(n/2)] : sorted[n/2-1].plus(sorted[n/2]).div(2));
}
export function vwap(rows: { price: string; quantity: number }[]): string | null {
  const count = rows.reduce((n,r)=>n+r.quantity,0);
  return count ? money(rows.reduce((n,r)=>n.plus(new Decimal(r.price).mul(r.quantity)),new Decimal(0)).div(count)) : null;
}
export function percent(before: string | number | null, after: string | number | null): string | null {
  if (before === null || after === null || new Decimal(before).isZero()) return null;
  return new Decimal(after).div(before).minus(1).mul(100).toFixed(2);
}
export { Decimal };
