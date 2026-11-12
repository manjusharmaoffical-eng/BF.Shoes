import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
const storefrontUi = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");

test("India market reports Razorpay and remains disabled until its integration is ready", () => {
  assert.match(storefront, /const indiaPaymentProvider = "Razorpay"/);
  assert.match(storefront, /const indiaPaymentConfigured = false/);
  assert.match(storefront, /const indiaCheckoutEnabled = false/);
  assert.match(storefront, /paymentProvider: indiaPaymentProvider, paymentConfigured: indiaPaymentConfigured, checkoutEnabled: indiaCheckoutEnabled/);
});

test("legacy PayU India checkout cannot be activated accidentally", () => {
  assert.match(storefront, /INDIA_PAYMENT_PROVIDER !== "payu"/);
  assert.match(storefront, /legacy PayU flow is disabled/);
});

test("storefront checkout copy names Razorpay, not PayU", () => {
  assert.match(storefrontUi, /Razorpay merchant credentials/);
  assert.match(storefrontUi, /Continue to Razorpay checkout/);
  assert.doesNotMatch(storefrontUi, /PayU/);
});
