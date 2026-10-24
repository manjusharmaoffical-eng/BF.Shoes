import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionOrder, orderRequestFingerprint, scopesForAdminRole } from "../src/policies.js";

test("administrator gets wildcard scope and staff is read-only", () => {
  assert.deepEqual(scopesForAdminRole("admin"), ["*"]);
  assert.deepEqual(scopesForAdminRole("staff"), ["products:read", "inventory:read", "orders:read"]);
  assert.deepEqual(scopesForAdminRole("unknown"), []);
});

test("order status policy permits only intended forward transitions", () => {
  assert.equal(canTransitionOrder("confirmed", "processing"), true);
  assert.equal(canTransitionOrder("confirmed", "cancelled"), true);
  assert.equal(canTransitionOrder("processing", "shipped"), true);
  assert.equal(canTransitionOrder("processing", "cancelled"), true);
  assert.equal(canTransitionOrder("shipped", "delivered"), true);
  assert.equal(canTransitionOrder("shipped", "cancelled"), false);
  assert.equal(canTransitionOrder("delivered", "processing"), false);
  assert.equal(canTransitionOrder("cancelled", "processing"), false);
  assert.equal(canTransitionOrder("confirmed", "confirmed"), false);
});

test("order fingerprints are stable and detect changed request content", () => {
  const first = {
    customer_name: "Customer",
    customer_email: "BUYER@example.com",
    items: [{ sku: "BF-001", quantity: 2 }]
  };
  const same = { ...first, customer_email: "buyer@example.com", items: [{ sku: "BF-001", quantity: 2 }] };
  const changed = { ...first, items: [{ sku: "BF-001", quantity: 3 }] };
  assert.equal(orderRequestFingerprint(first), orderRequestFingerprint(same));
  assert.notEqual(orderRequestFingerprint(first), orderRequestFingerprint(changed));
});
