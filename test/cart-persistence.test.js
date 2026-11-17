import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');

test('cart persistence stores only SKU and quantity in separate market buckets', () => {
  assert.match(source, /bf-shoes-cart:v1:\$\{market === 'AE' \? 'AE' : 'IN'\}/);
  assert.match(source, /sku: String\(item\.variant\?\.sku \|\| ''\)/);
  assert.match(source, /quantity: Math\.max\(1, Math\.min\(10,/);
  assert.match(source, /persistCart\(\);/);
});

test('restored cart is revalidated against current market and stock status while retaining unverified cart intent', () => {
  assert.match(source, /item\.currency === currency/);
  assert.match(source, /Number\(variant\?\.stock_qty\) \|\| 0/);
  assert.match(source, /variant && \(variant\.stock_verified === false \|\| stock > 0\)/);
  assert.match(source, /canReserveInCart \? Math\.min\(10,/);
  assert.match(source, /hydrateCart\(\);\s*renderCart\(\);/);
});

test('cart updates, market changes and successful orders persist the correct cart state', () => {
  assert.match(source, /state\.cartByMarket\[state\.market\] = state\.cart;\s*persistCart\(\);/);
  assert.match(source, /state\.market = nextMarket;[\s\S]{0,120}state\.cart = state\.cartByMarket\[state\.market\]/);
  assert.match(source, /state\.cart = \[\]; state\.cartByMarket\[state\.market\] = state\.cart; persistCart\(\)/);
});
