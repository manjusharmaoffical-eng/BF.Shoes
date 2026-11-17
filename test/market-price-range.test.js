import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8')
]);

test('catalog price range labels update with the selected INR or AED market', () => {
  assert.match(html, /id="price-range-min-value"/);
  assert.match(app, /range\.min = state\.market === 'IN' \? '699' : '10'/);
  assert.match(app, /range\.max = state\.market === 'IN' \? '4999' : '500'/);
  assert.match(app, /minValue\.textContent = money\(Number\(range\.min\) \* 100, state\.market === 'IN' \? 'INR' : 'AED'\)/);
});
