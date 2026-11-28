import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const finance = readFileSync(new URL("../src/finance.js", import.meta.url), "utf8");
const ultron = readFileSync(new URL("../src/ultron.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../frontend/admin.js", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../frontend/admin.html", import.meta.url), "utf8");
const warehouse = readFileSync(new URL("../src/warehouse.js", import.meta.url), "utf8");

test("finance summary and CSV value only physically verified inventory", () => {
  assert.ok((finance.match(/v\.stock_verified=true/g) || []).length >= 2);
  assert.match(finance, /unverified_variants/);
  assert.match(finance, /physical stock is unverified/);
});

test("Ultron low-stock alerts exclude unverified stock and report pending counts", () => {
  assert.match(ultron, /v\.stock_verified = true/);
  assert.match(ultron, /v\.stock_verified = false/);
  assert.match(ultron, /unverified_variants/);
  assert.match(ultron, /physical stock count/);
});

test("admin inventory and finance show unverified stock as zero and pending", () => {
  assert.match(admin, /esc\(v\.stock_verified \? v\.stock_qty : 0\)/);
  assert.match(admin, /Variants pending physical count/);
});

test("warehouse allocations are not presented as physically verified by variant-level counts", () => {
  assert.match(warehouse, /AS allocated_units/);
  assert.match(warehouse, /verified_sku_units/);
  assert.match(warehouse, /unverified_sku_units/);
  assert.match(warehouse, /v\.active=true AND v\.stock_verified=true AND v\.stock_qty<=5/);
  assert.doesNotMatch(warehouse, /sum\(wi\.quantity\) FILTER \(WHERE v\.stock_verified=true\)/);
  assert.doesNotMatch(admin, /Verified warehouse units/);
  assert.match(admin, /Allocated units \(location unverified\)/);
  assert.match(admin, /Location count pending/);
  assert.match(adminHtml, /<th>Location count status<\/th>/);
});
