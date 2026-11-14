export const UAE_EMIRATES = Object.freeze(["Abu Dhabi", "Ajman", "Dubai", "Fujairah", "Ras Al Khaimah", "Sharjah", "Umm Al Quwain"]);

export function parseUaeMarketEnv(env = {}) {
  const feeRaw = env.UAE_DELIVERY_FEE_FILS;
  const fee = feeRaw !== undefined && String(feeRaw).trim() !== "" && /^\d+$/.test(String(feeRaw).trim()) ? Number(feeRaw) : null;
  const configuredEmirates = [...new Set(String(env.UAE_DELIVERY_EMIRATES || "").split(",").map(x => x.trim()).filter(x => UAE_EMIRATES.includes(x)))];
  const paymentMethods = [...new Set(String(env.UAE_PAYMENT_METHODS || "").split(",").map(x => x.trim().toLowerCase()).filter(x => x === "cod"))];
  const vatStatus = ["registered", "not_registered"].includes(env.UAE_VAT_STATUS) ? env.UAE_VAT_STATUS : "unconfigured";
  return { fee, configuredEmirates, paymentMethods, vatStatus };
}

export function calculateUaeTotals(subtotalFils, deliveryFeeFils, taxRateBps) {
  for (const [name, value] of [["subtotal", subtotalFils], ["delivery fee", deliveryFeeFils], ["tax rate", taxRateBps]]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  if (taxRateBps > 10000) throw new RangeError("tax rate exceeds 100%");
  const taxBaseFils = subtotalFils + deliveryFeeFils;
  const vatFils = Math.round(taxBaseFils * taxRateBps / 10000);
  const totalFils = taxBaseFils + vatFils;
  if (![taxBaseFils, vatFils, totalFils].every(Number.isSafeInteger) || totalFils > 2000000000) throw new RangeError("order total exceeds supported limit");
  return { tax_base_fils: taxBaseFils, vat_fils: vatFils, total_fils: totalFils };
}
