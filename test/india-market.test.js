import test from "node:test";
import assert from "node:assert/strict";
import { INDIA_PINCODES, parseIndiaMarketEnv, calculateIndiaTotals } from "../src/india-market-policy.js";

test("India market defaults to PIN 500052 and keeps unknown delivery fee unknown", () => {
  const c = parseIndiaMarketEnv({});
  assert.equal(c.deliveryFeePaise, null);
  assert.deepEqual(c.deliveryPincodes, ["500052"]);
  assert.deepEqual(c.paymentMethods, []);
  assert.equal(c.gstStatus, "unconfigured");
  assert.equal(c.paymentGateway, "unconfigured");
  assert.deepEqual(INDIA_PINCODES, ["500052"]);
});

test("India market rejects unlisted PINs and unsupported payment methods", () => {
  const c = parseIndiaMarketEnv({ INDIA_DELIVERY_PINCODES: "500052,110001", INDIA_PAYMENT_METHODS: "cod,card,online" });
  assert.deepEqual(c.deliveryPincodes, ["500052"]);
  assert.deepEqual(c.paymentMethods, ["cod"], "Online must stay disabled even if configured in environment");
  assert.deepEqual(parseIndiaMarketEnv({ INDIA_PAYMENT_METHODS: "online" }).paymentMethods, [], "Online-only configuration must not enable checkout");
  assert.equal(parseIndiaMarketEnv({ INDIA_PAYMENT_GATEWAY: "razorpay", INDIA_GST_STATUS: "registered" }).paymentGateway, "razorpay");
  assert.equal(parseIndiaMarketEnv({ INDIA_PAYMENT_GATEWAY: "fake-gateway" }).paymentGateway, "unconfigured");
});

test("India totals calculate only the explicitly configured fee and tax rate", () => {
  assert.deepEqual(calculateIndiaTotals(10000, 500, 500), { tax_base_paise: 10500, tax_paise: 525, total_paise: 11025 });
  assert.deepEqual(calculateIndiaTotals(2900, 0, 0), { tax_base_paise: 2900, tax_paise: 0, total_paise: 2900 });
});

test("India totals reject negative, unsafe and over-100-percent inputs", () => {
  assert.throws(() => calculateIndiaTotals(-1, 0, 0), /non-negative/);
  assert.throws(() => calculateIndiaTotals(100, 0, 10001), /exceeds 100%/);
  assert.throws(() => calculateIndiaTotals(2000000000, 1, 0), /exceeds supported limit/);
});
