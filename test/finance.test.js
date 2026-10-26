import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfit } from "../src/finance-math.js";

test("profit report stays incomplete when any sold units lack recorded cost", () => {
  assert.deepEqual(calculateProfit({ revenueCents: "10000", cogsCents: "4000", expensesCents: "1000", missingCostUnits: 2 }), {
    gross_profit_cents: null, operating_profit_cents: null, complete: false, missing_cost_units: 2
  });
});

test("profit is calculated exactly in integer cents when costs are complete", () => {
  assert.deepEqual(calculateProfit({ revenueCents: "9007199254741000", cogsCents: "300", expensesCents: "50", missingCostUnits: 0 }), {
    gross_profit_cents: "9007199254740700", operating_profit_cents: "9007199254740650", complete: true, missing_cost_units: 0
  });
});

test("profit input rejects malformed amounts and missing cost counts", () => {
  assert.throws(() => calculateProfit({ revenueCents: "10.5", cogsCents: "1", expensesCents: "1", missingCostUnits: 0 }), TypeError);
  assert.throws(() => calculateProfit({ revenueCents: "10", cogsCents: "1", expensesCents: "1", missingCostUnits: -1 }), TypeError);
});
