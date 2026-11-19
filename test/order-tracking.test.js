import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [storefront, server, page, customerAuth] = await Promise.all([
  readFile(new URL('../src/storefront.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/server.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/track-order.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/customer-auth.js', import.meta.url), 'utf8')
]);

test('public order tracking requires the exact order number and checkout email', () => {
  assert.match(storefront, /storefrontRouter\.get\("\/orders\/track"/);
  assert.match(storefront, /WHERE order_number=\$1 AND customer_email=\$2/);
  assert.match(storefront, /No matching order found/);
  assert.match(storefront, /Cache-Control", "no-store"/);
  assert.doesNotMatch(storefront, /SELECT[^;]*(shipping_address|customer_phone)[^;]*FROM orders WHERE order_number/);
});

test('public tracking endpoint has a strict rate limit', () => {
  assert.match(server, /app\.use\("\/api\/v1\/store\/orders\/track", rateLimit\(\{ windowMs: 15 \* 60_000, limit: 8/);
});

test('tracking page validates order number and email and never exposes internal notes', () => {
  assert.match(page, /name="order_number" inputmode="numeric" pattern="\[0-9\]\{1,18\}" required/);
  assert.match(page, /name="email" type="email" maxlength="254" required/);
  assert.match(page, /\/api\/v1\/store\/orders\/track\?/);
  assert.doesNotMatch(page, /internal_note|unit_cost_cents|shipping_address|customer_phone/);
});

test('signed-in account order history is scoped to the authenticated customer account', () => {
  assert.match(customerAuth, /customerAuthRouter\.get\("\/orders"/);
  assert.match(customerAuth, /JOIN customer_accounts c ON lower\(c\.email\)=lower\(o\.customer_email\)/);
  assert.match(customerAuth, /WHERE c\.id=\$1 AND c\.active=true/);
});
