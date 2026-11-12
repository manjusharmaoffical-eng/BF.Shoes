import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalyticsCurrency } from "../src/analytics.js";

test("analytics accepts the two supported market currencies", () => {
  assert.deepEqual(parseAnalyticsCurrency("AED"), { success: true, data: "AED" });
  assert.deepEqual(parseAnalyticsCurrency("INR"), { success: true, data: "INR" });
});

test("analytics defaults to AED and rejects unsupported or mixed currencies", () => {
  assert.deepEqual(parseAnalyticsCurrency(undefined), { success: true, data: "AED" });
  assert.equal(parseAnalyticsCurrency("USD").success, false);
  assert.equal(parseAnalyticsCurrency("AED,INR").success, false);
});
