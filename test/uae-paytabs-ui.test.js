import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app, storefront] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront.js', import.meta.url), 'utf8')
]);

test('UAE checkout UI consistently identifies PayTabs and keeps the option disabled', () => {
  assert.match(html, /id="payment-paytabs-option"/);
  assert.match(html, /value="paytabs" disabled/);
  assert.match(html, /<strong>PayTabs<\/strong>/);
  assert.match(app, /payment_method: state\.market === 'AE' \? 'paytabs' : 'payu'/);
  assert.match(app, /PayTabs UAE checkout remains disabled/);
  assert.doesNotMatch(app, /Binance Pay|\/orders\/binance|pay\.binance\.com/);
  assert.match(storefront, /paymentProvider: "PayTabs"/);
  assert.match(storefront, /const uaeCheckoutEnabled = false/);
  assert.match(storefront, /UAE_PAYMENT_PROVIDER !== \"binance\"/);
  assert.match(storefront, /PayTabs is selected and checkout remains disabled/);
});
