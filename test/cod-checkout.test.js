import test from "node:test";
import assert from "node:assert/strict";
import { getCodMarketReadiness } from "../src/cod.js";

const readyEnv = {
  INDIA_COD_ENABLED: "true", INDIA_COD_VERIFIED: "true",
  INDIA_PRICING_VERIFIED: "true", INDIA_DELIVERY_FEE_VERIFIED: "true",
  INDIA_DELIVERY_FEE_PAISE: "5500", INDIA_GST_STATUS: "registered",
  UAE_COD_ENABLED: "true", UAE_COD_VERIFIED: "true",
  UAE_PRICING_VERIFIED: "true", UAE_DELIVERY_FEE_VERIFIED: "true",
  UAE_DELIVERY_FEE_FILS: "1500", UAE_DELIVERY_EMIRATES: "Abu Dhabi,Dubai",
  UAE_VAT_STATUS: "registered"
};
const db = {
  async query(sql) {
    if (sql.includes("GROUP BY p.currency")) return { rows: [{ currency: "INR", product_count: 10, invalid_price_products: 0, verified_stock_variants: 4 }, { currency: "AED", product_count: 10, invalid_price_products: 0, verified_stock_variants: 3 }] };
    if (sql.includes("GROUP BY jurisdiction")) return { rows: [
      { jurisdiction: "IN_GST", count: 1, india_valid: true, uae_valid: null, tax_rate_bps: 500 },
      { jurisdiction: "AE_VAT", count: 1, india_valid: null, uae_valid: true, tax_rate_bps: 500 }
    ] };
    throw new Error("Unexpected query in COD readiness test");
  }
};

test("COD readiness requires explicit owner enablement, verified market prices, delivery fee and tax status", async () => {
  const ready = await getCodMarketReadiness(db, readyEnv);
  assert.equal(ready.IN.enabled, true);
  assert.equal(ready.AE.enabled, true);
  assert.equal(ready.IN.deliveryFee, 5500);
  assert.equal(ready.AE.deliveryFee, 1500);
  assert.equal(ready.IN.taxRateBps, 500);
  assert.equal(ready.AE.taxRateBps, 500);
  assert.deepEqual(ready.AE.emirates, ["Abu Dhabi", "Dubai"]);
});

test("COD stays disabled if any market verification flag or required tax profile is missing", async () => {
  for (const key of ["INDIA_COD_VERIFIED", "INDIA_PRICING_VERIFIED", "INDIA_DELIVERY_FEE_VERIFIED", "INDIA_GST_STATUS"]) {
    const env = { ...readyEnv };
    delete env[key];
    assert.equal((await getCodMarketReadiness(db, env)).IN.enabled, false, key);
  }
  for (const key of ["UAE_COD_VERIFIED", "UAE_PRICING_VERIFIED", "UAE_DELIVERY_FEE_VERIFIED", "UAE_VAT_STATUS", "UAE_DELIVERY_EMIRATES"]) {
    const env = { ...readyEnv };
    delete env[key];
    assert.equal((await getCodMarketReadiness(db, env)).AE.enabled, false, key);
  }
});

test("COD remains disabled when any active product in a market has an invalid stored price", async () => {
  const invalidPriceDb = { async query(sql) {
    if (sql.includes("GROUP BY p.currency")) return { rows: [
      { currency: "INR", product_count: 10, invalid_price_products: 1, verified_stock_variants: 4 },
      { currency: "AED", product_count: 10, invalid_price_products: 1, verified_stock_variants: 3 }
    ] };
    return db.query(sql);
  } };
  const result = await getCodMarketReadiness(invalidPriceDb, readyEnv);
  assert.equal(result.IN.enabled, false);
  assert.equal(result.AE.enabled, false);
});

test("COD remains disabled when the selected market has no physically verified available stock", async () => {
  const noVerifiedStockDb = { async query(sql) {
    if (sql.includes("GROUP BY p.currency")) return { rows: [{ currency: "INR", product_count: 10, invalid_price_products: 0, verified_stock_variants: 0 }, { currency: "AED", product_count: 10, invalid_price_products: 0, verified_stock_variants: 0 }] };
    return db.query(sql);
  } };
  const result = await getCodMarketReadiness(noVerifiedStockDb, readyEnv);
  assert.equal(result.IN.enabled, false);
  assert.equal(result.AE.enabled, false);
});

test("COD cannot treat a missing delivery fee as a zero-fee verified delivery", async () => {
  const indiaEnv = { ...readyEnv }; delete indiaEnv.INDIA_DELIVERY_FEE_PAISE;
  const uaeEnv = { ...readyEnv }; delete uaeEnv.UAE_DELIVERY_FEE_FILS;
  const resultIN = await getCodMarketReadiness(db, indiaEnv);
  const resultAE = await getCodMarketReadiness(db, uaeEnv);
  assert.equal(resultIN.IN.enabled, false);
  assert.equal(resultIN.IN.deliveryFee, null);
  assert.equal(resultAE.AE.enabled, false);
  assert.equal(resultAE.AE.deliveryFee, null);
});

test("COD checkout has a dedicated idempotent endpoint and never creates a payment attempt", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../src/cod.js", import.meta.url), "utf8");
  assert.match(route, /codRouter\.post\("\/orders\/cod"/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /payment_status.*unpaid/);
  assert.match(route, /storefront_cod_order/);
  assert.doesNotMatch(route, /INSERT INTO payment_attempts/);
  assert.match(route, /stock_verified/);
  assert.match(route, /isValidPriceCents\(item\.price_cents\)/);
  assert.match(route, /shipping_emirate/);
});
