import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html, app, storefront] = await Promise.all([
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront.js', import.meta.url), 'utf8')
]);

test('UAE checkout identifies PayTabs and disables the payment control until readiness is verified', () => {
  assert.match(html, /id="payment-paytabs-option"/);
  assert.match(html, /value="paytabs" disabled/);
  assert.match(html, /<strong>Pay securely with PayTabs<\/strong>/);
  assert.match(app, /payment_method: state\.market === 'AE' \? 'paytabs' : String\(formData\.get\('payment_method'\) \|\| 'payu'\)/);
  assert.match(app, /paytabsInput\.disabled = !\(state\.market === 'AE' && state\.checkoutReady\)/);
  assert.match(app, /placeOrder\.disabled = !state\.checkoutReady/);
  assert.doesNotMatch(app, /Binance Pay|\/orders\/binance|pay\.binance\.com/);
  assert.match(storefront, /paymentProvider: "PayTabs"/);
  assert.match(storefront, /UAE_CHECKOUT_VERIFIED/);
  assert.match(storefront, /UAE_PAYMENT_PROVIDER !== "binance"/);
  assert.match(storefront, /PayTabs is selected and checkout remains disabled/);
});
