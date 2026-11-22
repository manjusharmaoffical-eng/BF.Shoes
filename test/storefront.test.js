import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStorefrontItems, isValidPriceCents, storefrontRequestFingerprint } from "../src/storefront-policies.js";

const checkout = {
  customer_name: " Buyer ", customer_email: "BUYER@example.com", customer_phone: "+971 50 123 4567",
  shipping_address: "  12 Main Street\nAbu Dhabi  ", items: [{ sku: "BF-001", quantity: 1 }, { sku: "BF-002", quantity: 2 }]
};

test("storefront fingerprints normalize email/address and item ordering", () => {
  const equivalent = { ...checkout, customer_name: "Buyer", customer_email: "buyer@example.com", customer_phone: "+971501234567", shipping_address: "12 Main Street Abu Dhabi", items: [...checkout.items].reverse() };
  assert.equal(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint(equivalent));
});

test("storefront fingerprints include phone, address, and quantity", () => {
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, customer_phone: "+971501234568" }));
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, shipping_address: "13 Main Street Abu Dhabi" }));
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, items: [{ sku: "BF-001", quantity: 2 }, { sku: "BF-002", quantity: 2 }] }));
});

test("storefront aggregates duplicate SKU lines", () => {
  assert.deepEqual([...aggregateStorefrontItems([{ sku: "BF-001", quantity: 1 }, { sku: "BF-001", quantity: 2 }]).entries()], [["BF-001", 3]]);
});


test("storefront fingerprints distinguish payment method, market and delivery PIN", () => {
  const checkout = {
    customer_name: "Buyer",
    customer_email: "buyer@example.com",
    customer_phone: "+971 50 123 4567",
    shipping_address: "12 Main Street Abu Dhabi",
    shipping_country: "IN",
    shipping_pincode: "500052",
    payment_method: "payu",
    items: [{ sku: "BF-SPEED-7", quantity: 1 }]
  };
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, payment_method: "payu_qr" }));
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, shipping_country: "AE" }));
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, shipping_pincode: "110001" }));
  assert.notEqual(storefrontRequestFingerprint(checkout), storefrontRequestFingerprint({ ...checkout, shipping_emirate: "Dubai" }));
});


test("price validation rejects null, zero, negative, fractional and unsafe cent values", () => {
  for (const value of [null, undefined, "", "0", 0, -1, "-1", 1.5, "1.5", " 2500", Number.MAX_SAFE_INTEGER + 1, "9007199254740992"]) {
    assert.equal(isValidPriceCents(value), false, String(value));
  }
  for (const value of [1, 2500, "2500", 999999999]) {
    assert.equal(isValidPriceCents(value), true, String(value));
  }
});
