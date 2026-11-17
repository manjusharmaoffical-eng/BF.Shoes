import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storefront = await readFile(new URL('../src/storefront.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
const policy = await readFile(new URL('../src/india-market-policy.js', import.meta.url), 'utf8');

test('India market consistently reports the owner-selected PayU provider and never enables checkout here', () => {
  assert.match(storefront, /const indiaPayuConfigured = process\.env\.INDIA_PAYMENT_GATEWAY === "payu" && indiaPaymentMethods\.includes\("payu"\) && payuConfigured\(\)/);
  assert.match(storefront, /paymentProvider: "PayU", paymentConfigured: indiaPayuConfigured/);
  assert.match(storefront, /const onlineReady = env\.paymentGateway === "payu" && env\.paymentMethods\.includes\("payu"\) && payuConfigured\(\)/);
  assert.match(storefront, /INDIA_CHECKOUT_VERIFIED === "true" && indiaPricingVerified && indiaFeeConfigured && row\.india_tax_profile_configured && indiaPayuConfigured/);
  assert.match(storefront, /INDIA_CHECKOUT_VERIFIED !== "true"/);
  assert.match(storefront, /payu_credentials_not_configured/);
  assert.doesNotMatch(storefront, /Razorpay credentials|paymentProvider: "Razorpay"/);
});

test('India environment accepts PayU only as the configured online payment provider', () => {
  assert.match(policy, /env\.INDIA_PAYMENT_GATEWAY === "payu" \? "payu"/);
  assert.match(policy, /method === "payu" && paymentGateway === "payu"/);
});

test('storefront checkout guidance names PayU consistently for India', () => {
  assert.match(app, /PayU merchant credentials/);
  assert.doesNotMatch(app, /Razorpay/);
});


test('separate AED catalog products do not block India pricing or trigger an invented currency conversion', () => {
  assert.doesNotMatch(storefront, /product_price_conversion_required/);
  assert.match(storefront, /no_inr_priced_products/);
  assert.match(storefront, /INR and AED are separate market catalogs/);
});


test('India checkout UI shows disabled PayU only and does not promise unconfigured COD', () => {
  assert.match(html, /id="payment-payu-option"/);
  assert.match(html, /value="payu"[^>]*disabled/);
  assert.doesNotMatch(html, /payment-cod-option|Cash on Delivery available/);
  assert.match(app, /payment_method: state\.market === 'AE' \? 'paytabs' : String\(formData\.get\('payment_method'\) \|\| 'payu'\)/);
  assert.match(app, /Checkout opens after verified INR prices, delivery fee, GST profile and PayU merchant credentials are configured/);
});


test('legacy direct order endpoint cannot bypass PayU or PayTabs market checkout gates', () => {
  assert.match(storefront, /storefrontRouter\.post\("\/orders", async/);
  assert.match(storefront, /Direct order creation is disabled/);
  assert.doesNotMatch(storefront, /storefront_cod_order/);
});
