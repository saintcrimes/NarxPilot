import { translate } from '../lib/translations';

type SearchField = 'code' | 'category' | 'brand' | 'model' | 'variant' | 'condition' | 'region' | 'warranty' | 'unit';
export type SearchableProduct = Record<SearchField, string>;
const fields: SearchField[] = ['code', 'category', 'brand', 'model', 'variant', 'condition', 'region', 'warranty', 'unit'];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/['’‘ʻʼ`´]/gu, '')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Match query words independently, retaining exact numeric pack sizes and SKU digits. */
export function matchesProductSearch(product: SearchableProduct, search: string): boolean {
  const tokens = normalize(search).split(/\s+/u).filter(Boolean);
  if (!tokens.length) return true;
  const labels = fields.flatMap(field => {
    const value = product[field];
    return [value, translate(value, 'en'), translate(value, 'uz')].map(normalize);
  });
  const words = new Set(labels.flatMap(label => label.split(/\s+/u)));
  const compactLabels = labels.map(label => label.replaceAll(' ', ''));
  return tokens.every(token => /^\p{N}+$/u.test(token)
    ? words.has(token)
    : labels.some(label => label.includes(token)) || compactLabels.some(label => label.includes(token)));
}
