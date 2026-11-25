function cents(value) {
  const raw = String(value ?? "0");
  if (!/^\d+$/.test(raw)) throw new TypeError("Cents must be a non-negative integer");
  return BigInt(raw);
}
export function calculateProfit({ revenueCents, cogsCents, expensesCents, interestCents = "0", missingCostUnits }) {
  const revenue = cents(revenueCents);
  const cogs = cents(cogsCents);
  const expenses = cents(expensesCents);
  const interest = cents(interestCents);
  const missing = Number(missingCostUnits ?? 0);
  if (!Number.isSafeInteger(missing) || missing < 0) throw new TypeError("Missing-cost unit count must be a non-negative integer");
  const complete = missing === 0;
  return {
    gross_profit_cents: complete ? String(revenue - cogs) : null,
    operating_profit_cents: complete ? String(revenue - cogs - expenses) : null,
    net_profit_cents: complete ? String(revenue - cogs - expenses - interest) : null,
    complete,
    missing_cost_units: missing
  };
}


export function calculateInventoryValuation({ stockedVariants, totalUnits, missingCostVariants, unverifiedVariants = 0, knownInventoryValueCents }) {
  const count = (value, label) => {
    const number = Number(value ?? 0);
    if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`);
    return number;
  };
  const stocked = count(stockedVariants, "Stocked variant count");
  const units = count(totalUnits, "Stock unit count");
  const missing = count(missingCostVariants, "Missing-cost variant count");
  const unverified = count(unverifiedVariants, "Unverified variant count");
  const knownValue = cents(knownInventoryValueCents);
  if (missing > stocked || stocked > units) throw new TypeError("Inventory counts are inconsistent");
  const complete = missing === 0 && unverified === 0;
  return {
    complete,
    stocked_variants: stocked,
    total_units: units,
    missing_cost_variants: missing,
    unverified_variants: unverified,
    inventory_value_cents: complete ? String(knownValue) : null,
    known_inventory_value_cents: String(knownValue)
  };
}
