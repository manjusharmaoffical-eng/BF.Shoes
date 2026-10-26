function cents(value) {
  const raw = String(value ?? "0");
  if (!/^\d+$/.test(raw)) throw new TypeError("Cents must be a non-negative integer");
  return BigInt(raw);
}
export function calculateProfit({ revenueCents, cogsCents, expensesCents, missingCostUnits }) {
  const revenue = cents(revenueCents);
  const cogs = cents(cogsCents);
  const expenses = cents(expensesCents);
  const missing = Number(missingCostUnits ?? 0);
  if (!Number.isSafeInteger(missing) || missing < 0) throw new TypeError("Missing-cost unit count must be a non-negative integer");
  const complete = missing === 0;
  return {
    gross_profit_cents: complete ? String(revenue - cogs) : null,
    operating_profit_cents: complete ? String(revenue - cogs - expenses) : null,
    complete,
    missing_cost_units: missing
  };
}
