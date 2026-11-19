import test from "node:test";
import assert from "node:assert/strict";
import { UAE_EMIRATES, parseUaeMarketEnv, calculateUaeTotals } from "../src/uae-market-policy.js";

test("UAE checkout configuration stays closed when real fee, coverage and VAT status are missing", () => {
  const c = parseUaeMarketEnv({});
  assert.equal(c.fee, null);
  assert.deepEqual(c.configuredEmirates, []);
  assert.deepEqual(c.paymentMethods, []);
  assert.equal(c.vatStatus, "unconfigured");
});

test("UAE delivery configuration only accepts known emirates and the selected PayTabs provider", () => {
  const c = parseUaeMarketEnv({ UAE_DELIVERY_FEE_FILS: "0", UAE_DELIVERY_EMIRATES: "Dubai, Fake City, Dubai, Sharjah", UAE_PAYMENT_METHODS: "paytabs,cod,upi,card", UAE_VAT_STATUS: "not_registered" });
  assert.equal(c.fee, 0);
  assert.deepEqual(c.configuredEmirates, ["Dubai", "Sharjah"]);
  assert.deepEqual(c.paymentMethods, ["paytabs"]);
  assert.deepEqual(parseUaeMarketEnv({ UAE_PAYMENT_METHODS: "cod" }).paymentMethods, [], "COD is not enabled as an unverified fallback");
  assert.equal(c.vatStatus, "not_registered");
  assert.equal(UAE_EMIRATES.length, 7);
});

test("UAE VAT is rounded in fils over the configured subtotal plus delivery fee", () => {
  assert.deepEqual(calculateUaeTotals(10000, 500, 500), { tax_base_fils: 10500, vat_fils: 525, total_fils: 11025 });
});

test("UAE unregistered checkout calculates no VAT when explicitly configured", () => {
  assert.deepEqual(calculateUaeTotals(2900, 0, 0), { tax_base_fils: 2900, vat_fils: 0, total_fils: 2900 });
});

test("UAE order totals reject invalid amounts and unsafe totals", () => {
  assert.throws(() => calculateUaeTotals(-1, 0, 500), /non-negative/);
  assert.throws(() => calculateUaeTotals(100, 0, 10001), /exceeds 100%/);
  assert.throws(() => calculateUaeTotals(2000000000, 1, 0), /exceeds supported limit/);
});
