import test from "node:test";
import assert from "node:assert/strict";
import { parseFinanceCurrency } from "../src/finance-validation.js";

test("finance accepts INR and AED without mixing markets", () => {
  assert.deepEqual(parseFinanceCurrency("INR"), { success: true, data: "INR" });
  assert.deepEqual(parseFinanceCurrency("AED"), { success: true, data: "AED" });
});

test("finance defaults to INR but rejects unsupported and mixed currencies", () => {
  assert.deepEqual(parseFinanceCurrency(undefined), { success: true, data: "INR" });
  assert.equal(parseFinanceCurrency("USD").success, false);
  assert.equal(parseFinanceCurrency("INR,AED").success, false);
  assert.equal(parseFinanceCurrency("").success, false);
});
