import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../schema.sql");
const migration = read("../migrations/2026-11-17-variant-stock-verification.sql");
const storefront = read("../src/storefront.js");
const routes = read("../src/routes.js");
const warehouse = read("../src/warehouse.js");
const app = read("../frontend/app.js");
const admin = read("../frontend/admin.js");

test("variant stock defaults to unverified and the migration is additive", () => {
  assert.match(schema, /stock_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS stock_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT)|DELETE\s+FROM|TRUNCATE/i);
});

test("public catalog never advertises unverified quantities or unverified market prices", () => {
  assert.match(storefront, /CASE WHEN v\.stock_verified THEN v\.stock_qty ELSE 0 END/);
  assert.match(storefront, /'stock_verified', v\.stock_verified/);
  assert.match(storefront, /price_pending_conversion: !pricingVerified \|\| product\.price_pending_conversion/);
});

test("all shopper and staff order paths reject stock without a physical verification", () => {
  assert.match(storefront, /if\(!v\.stock_verified\)/);
  assert.match(storefront, /if \(!v\.stock_verified\)/);
  assert.match(routes, /if \(!v\.stock_verified\)/);
});

test("manual inventory, warehouse and production counts mark only adjusted variants verified", () => {
  assert.match(routes, /UPDATE variants SET stock_qty=\$1, stock_verified=true/);
  assert.match(warehouse, /stock_verified=true/);
});

test("storefront and admin clearly label pending physical stock counts", () => {
  assert.match(app, /Stock check pending/);
  assert.match(app, /Stock verification pending/);
  assert.match(admin, /Pending physical count/);
});
