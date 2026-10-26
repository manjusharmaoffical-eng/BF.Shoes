import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfit } from "../src/finance-math.js";

test("calculates gross, operating and net profit in integer cents", () => {
  assert.deepEqual(
    calculateProfit({
      revenueCents: "250000",
      cogsCents: "100000",
      expensesCents: "25000",
      interestCents: "5000",
      missingCostUnits: 0
    }),
    {
      gross_profit_cents: "150000",
      operating_profit_cents: "125000",
      net_profit_cents: "120000",
      complete: true,
      missing_cost_units: 0
    }
  );
});

test("does not report a final profit when any delivered unit is missing cost", () => {
  const result = calculateProfit({
    revenueCents: "250000",
    cogsCents: "100000",
    expensesCents: "25000",
    interestCents: "5000",
    missingCostUnits: 2
  });
  assert.equal(result.complete, false);
  assert.equal(result.missing_cost_units, 2);
  assert.equal(result.gross_profit_cents, null);
  assert.equal(result.operating_profit_cents, null);
  assert.equal(result.net_profit_cents, null);
});

test("preserves a genuine net loss rather than clamping profit to zero", () => {
  const result = calculateProfit({
    revenueCents: "10000",
    cogsCents: "12000",
    expensesCents: "3000",
    interestCents: "500",
    missingCostUnits: 0
  });
  assert.equal(result.net_profit_cents, "-5500");
});

test("rejects non-integer cents and invalid missing-cost counts", () => {
  assert.throws(() => calculateProfit({
    revenueCents: "10.5",
    cogsCents: "0",
    expensesCents: "0",
    missingCostUnits: 0
  }), /non-negative integer/);
  assert.throws(() => calculateProfit({
    revenueCents: "10",
    cogsCents: "0",
    expensesCents: "0",
    missingCostUnits: -1
  }), /non-negative integer/);
});
