import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [schema, auth, app] = await Promise.all([
  readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/customer-auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8')
]);

test('customer wishlist is additive, account-owned and cascades safely on deletion', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.customer_wishlist/);
  assert.match(schema, /customer_id UUID NOT NULL REFERENCES public\.customer_accounts\(id\) ON DELETE CASCADE/);
  assert.match(schema, /product_id UUID NOT NULL REFERENCES public\.products\(id\) ON DELETE CASCADE/);
  assert.match(schema, /PRIMARY KEY \(customer_id, product_id\)/);
});

test('wishlist API requires a valid customer session and never accepts a customer id from the request', () => {
  assert.match(auth, /customerAuthRouter\.get\("\/wishlist"/);
  assert.match(auth, /customerAuthRouter\.put\("\/wishlist\/:productId"/);
  assert.match(auth, /customerAuthRouter\.delete\("\/wishlist\/:productId"/);
  assert.equal((auth.match(/getCustomerSession\(req\)/g) || []).length >= 6, true);
  assert.match(auth, /WHERE w\.customer_id=\$1/);
  assert.match(auth, /z\.string\(\)\.uuid\(\)\.safeParse\(req\.params\.productId\)/);
  assert.match(auth, /total >= 200/);
  assert.match(auth, /FOR UPDATE/);
  assert.match(auth, /Serialize additions per customer/);
  assert.doesNotMatch(auth, /req\.body\.customer_id|req\.query\.customer_id/);
});

test('wishlist sync uses the signed-in customer token while preserving anonymous local saves', () => {
  assert.match(app, /sessionStorage\.getItem\('bf_customer_token'\)/);
  assert.match(app, /request\('\/api\/v1\/customer-auth\/wishlist'/);
  assert.match(app, /method: removing \? 'DELETE' : 'PUT'/);
  assert.match(app, /localStorage\.setItem\('bf-shoes-wishlist'/);
  assert.match(app, /Sign in to sync your wishlist across devices/);
});
