import test from "node:test";
import assert from "node:assert/strict";
import { INDIA_PINCODES, parseIndiaMarketEnv, calculateIndiaTotals, resolveIndiaGstStatus } from "../src/india-market-policy.js";

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
  assert.deepEqual(c.paymentMethods, [], "COD and unsupported payment methods stay disabled");
  assert.deepEqual(parseIndiaMarketEnv({ INDIA_PAYMENT_METHODS: "cod" }).paymentMethods, [], "COD is not an approved India payment method");
  assert.deepEqual(parseIndiaMarketEnv({ INDIA_PAYMENT_METHODS: "online" }).paymentMethods, [], "Unknown online methods stay disabled");
  assert.deepEqual(parseIndiaMarketEnv({ INDIA_PAYMENT_GATEWAY: "payu", INDIA_PAYMENT_METHODS: "payu" }).paymentMethods, ["payu"]);
  assert.deepEqual(parseIndiaMarketEnv({ INDIA_PAYMENT_GATEWAY: "other", INDIA_PAYMENT_METHODS: "payu" }).paymentMethods, []);
  assert.equal(parseIndiaMarketEnv({ INDIA_PAYMENT_GATEWAY: "payu", INDIA_GST_STATUS: "registered" }).paymentGateway, "payu");
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

test("India GST status stays pending until one complete GST profile is present", () => {
  const validProfile = {
    currency: "INR",
    registration_number: "TEST-GSTIN",
    seller_state: "Telangana",
    tax_rate_bps: 500
  };
  assert.equal(resolveIndiaGstStatus("registered", null), "unconfigured");
  assert.equal(resolveIndiaGstStatus("registered", { ...validProfile, registration_number: "" }), "unconfigured");
  assert.equal(resolveIndiaGstStatus("registered", { ...validProfile, seller_state: "" }), "unconfigured");
  assert.equal(resolveIndiaGstStatus("registered", { ...validProfile, currency: "AED" }), "unconfigured");
  assert.equal(resolveIndiaGstStatus("registered", { ...validProfile, tax_rate_bps: 0 }), "unconfigured");
  assert.equal(resolveIndiaGstStatus("registered", validProfile), "registered");
  assert.equal(resolveIndiaGstStatus("not_registered", null), "not_registered");
  assert.equal(resolveIndiaGstStatus("unconfigured", validProfile), "unconfigured");
});
