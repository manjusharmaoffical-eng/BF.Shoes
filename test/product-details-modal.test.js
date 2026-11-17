import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8')
]);

test('product details modal exposes accessible dialog, specifications and four photo angles', () => {
  assert.match(html, /id="product-detail-backdrop" aria-hidden="true"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="product-detail-title"/);
  for (const id of ['product-detail-image','product-detail-thumbs','product-detail-specs','product-detail-sizes','product-detail-note']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const angle of ['front','back','top','bottom']) assert.match(app, new RegExp(`'${angle}'`));
});

test('product details modal traps focus, closes on Escape and returns focus to the opener', () => {
  assert.match(app, /previousProductDetailsFocus = document\.activeElement/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /event\.key !== 'Tab'/);
  assert.match(app, /previousProductDetailsFocus\?\.focus\?\.\(\)/);
});

test('product specs and photo alt text are escaped; missing angles are labelled as pending', () => {
  assert.match(app, /escapeHtml\(label\)/);
  assert.match(app, /escapeHtml\(value\)/);
  assert.match(app, /Photo pending/);
  assert.match(app, /url === current \? 'active' : ''/);
});
