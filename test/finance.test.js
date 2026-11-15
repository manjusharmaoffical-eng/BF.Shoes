import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfit } from "../src/finance-math.js";

test("profit report stays incomplete when any sold units lack recorded cost", () => {
  assert.deepEqual(calculateProfit({ revenueCents: "10000", cogsCents: "4000", expensesCents: "1000", missingCostUnits: 2 }), {
    gross_profit_cents: null, operating_profit_cents: null, net_profit_cents: null, complete: false, missing_cost_units: 2
  });
});

test("profit is calculated exactly in integer cents when costs are complete", () => {
  assert.deepEqual(calculateProfit({ revenueCents: "9007199254741000", cogsCents: "300", expensesCents: "50", interestCents: "25", missingCostUnits: 0 }), {
    gross_profit_cents: "9007199254740700", operating_profit_cents: "9007199254740650", net_profit_cents: "9007199254740625", complete: true, missing_cost_units: 0
  });
});

test("profit input rejects malformed amounts and missing cost counts", () => {
  assert.throws(() => calculateProfit({ revenueCents: "10.5", cogsCents: "1", expensesCents: "1", missingCostUnits: 0 }), TypeError);
  assert.throws(() => calculateProfit({ revenueCents: "10", cogsCents: "1", expensesCents: "1", missingCostUnits: -1 }), TypeError);
});


test("finance expense ledger uses the same selected currency and date range as the P/L report", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/finance.js", import.meta.url), "utf8");
  const start = source.indexOf('financeRouter.get("/expenses"');
  const end = source.indexOf('financeRouter.post("/expenses"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start, "expense list route exists");
  assert.match(route, /dateQuery\.safeParse\(req\.query\)/);
  assert.match(route, /expense_date >= \$1/);
  assert.match(route, /expense_date <= \$2/);
  assert.match(route, /currency=\$3/);
});

test("finance admin shows revenue components and period expense categories", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  assert.match(html, /id="finance-category-breakdown"/);
  assert.match(js, /Product revenue/);
  assert.match(js, /Delivery fee revenue/);
  assert.ok(js.includes("req('/finance/expenses?'+params.toString())"));
  assert.match(js, /expenses_by_category/);
});
