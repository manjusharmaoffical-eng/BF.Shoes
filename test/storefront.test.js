import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "../src/storefront-policies.js";

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
