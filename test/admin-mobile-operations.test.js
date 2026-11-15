import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canTransitionOrder } from '../src/policies.js';

const html = await readFile(new URL('../frontend/admin.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8');

test('admin navigation is labelled and supports compact mobile horizontal scrolling', () => {
  assert.match(html, /<nav class="tabs" aria-label="Admin sections">/);
  assert.match(html, /flex-wrap:nowrap;overflow-x:auto/);
  assert.match(html, /min-height:42px/);
  assert.match(html, /focus-visible/);
});

test('admin order controls only expose valid next status transitions', () => {
  assert.match(js, /const ORDER_NEXT=\{confirmed:\['processing','cancelled'\],processing:\['shipped','cancelled'\],shipped:\['delivered'\],delivered:\[\],cancelled:\[\]\}/);
  assert.match(js, /ORDER_NEXT\[o\.status\]/);
  assert.match(js, /does not automatically refund a payment/);
  assert.equal(canTransitionOrder('confirmed', 'processing'), true);
  assert.equal(canTransitionOrder('confirmed', 'delivered'), false);
  assert.equal(canTransitionOrder('shipped', 'delivered'), true);
  assert.equal(canTransitionOrder('delivered', 'processing'), false);
});

test('admin mobile form controls remain touch-friendly', () => {
  assert.match(html, /min-height:42px;font-size:16px/);
  assert.match(html, /-webkit-overflow-scrolling:touch/);
});


test('homepage category pills and category cards actually filter the product catalogue', async () => {
  const home = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
  for (const category of ['all', 'men', 'women', 'sports', 'casual']) {
    assert.match(home, new RegExp('data-category-jump="' + category + '"'));
  }
  assert.match(app, /\$\$\('\[data-category-jump\]'\)/);
  assert.match(app, /state\.categories=category==='all'\?\[\]:\[category\]/);
  assert.match(app, /input\.checked=state\.categories\.includes/);
});
