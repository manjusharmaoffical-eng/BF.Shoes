import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8')
]);

test('catalogue does not expose or silently apply a global price/category filter', () => {
  assert.doesNotMatch(html, /price-range|sort-label|product-sort|catalog-sidebar|mobile-filter-trigger/);
  assert.doesNotMatch(app, /matchesPrice|matchesCategory|state\.maxPriceCents|state\.categories/);
  assert.match(app, /const marketProducts = state\.products\.filter\(product => product\.currency === marketCurrency\)/);
});
