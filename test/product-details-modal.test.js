import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app, css] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8')
]);

test('product details modal exposes an accessible dialog and a dynamic multi-image gallery', () => {
  assert.match(html, /id="product-detail-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="product-detail-content"/);
  assert.match(html, /data-detail-close/);
  assert.match(app, /\/api\/v1\/store\/products\//);
  assert.match(app, /\/images/);
  assert.match(app, /data-detail-image/);
  assert.match(app, /data-detail-size/);
  assert.match(app, /data-detail-color/);
  assert.match(css, /product-detail-modal/);
});

test('product details modal traps focus, closes on Escape and returns focus to the opener', () => {
  assert.match(app, /previousProductDetailsFocus = document\.activeElement/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /event\.key !== 'Tab'/);
  assert.match(app, /previousProductDetailsFocus\?\.focus\?\.\(\)/);
});

test('modal content escapes user-supplied product names, image URLs and size labels', () => {
  assert.match(app, /escapeHtml\(image\.image_url\)/);
  assert.match(app, /escapeHtml\(product\.name\)/);
  assert.match(app, /escapeHtml\(v\.size_label\)/);
  assert.doesNotMatch(app, /within 12 hours after delivery/);
});

test('product details expose variant filters, product metadata and recorded attributes', () => {
  assert.match(app, /detail-option-group/);
  assert.match(app, /detail-meta/);
  assert.match(app, /detail-specifications/);
  assert.match(app, /product\.attributes/);
  assert.match(app, /product\.mrp_cents/);
  assert.match(app, /Stock verification pending/);
  assert.match(app, /data-detail-color/);
  assert.match(app, /data-detail-size/);
});
test('footer preserves category, sizing, delivery and customer-support destinations', () => {
  for (const href of ['/collections.html','/men.html','/women.html','/sports.html','/casual.html','/running.html','/sneakers.html','/watches.html','/eyewear.html','/size-guide.html','/fit-guide.html','/shoe-care.html','/shipping.html','/returns.html','/faq.html','/contact.html','/track-order.html']) {
    assert.ok(html.includes('href="' + href + '"'), 'missing footer destination ' + href);
  }
});
