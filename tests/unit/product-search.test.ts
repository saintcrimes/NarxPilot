import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesProductSearch, type SearchableProduct } from '../../src/domain/product-search';

const flour: SearchableProduct = {
  code: 'GR-001', brand: 'Makfa', model: 'Мука пшеничная высший сорт',
  variant: '2 кг', category: 'Мука и выпечка', condition: 'packaged',
  region: 'UZ', warranty: 'Срок годности по упаковке', unit: 'уп.',
};

test('Поиск сопоставляет бренд и упаковку независимо от промежуточных слов', () => {
  for (const search of ['Makfa 2 кг', 'Makfa2kg', '2кг Makfa', 'flour2kg', 'bugdoyuni2kg', "bug'doy uni 2 kg", 'bugʻdoy uni 2 kg', 'bug‘doy uni 2 kg']) {
    assert.equal(matchesProductSearch(flour, search), true, search);
  }
});

test('Поиск кода допускает дефис и сохраняет точные цифры SKU', () => {
  for (const search of ['GR-001', 'gr001', 'GR 001', '']) assert.equal(matchesProductSearch(flour, search), true, search);
  for (const search of ['GR002', 'Makfa 1 kg', 'Makfa 20 kg', 'rice', "' OR 1=1 --"]) assert.equal(matchesProductSearch(flour, search), false, search);
});
