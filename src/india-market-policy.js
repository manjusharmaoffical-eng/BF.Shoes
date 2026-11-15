export const INDIA_PINCODES = Object.freeze(["500052"]);

export function parseIndiaMarketEnv(env = {}) {
  const feeRaw = env.INDIA_DELIVERY_FEE_PAISE;
  const deliveryFeePaise = feeRaw !== undefined && String(feeRaw).trim() !== "" && /^\d+$/.test(String(feeRaw).trim()) ? Number(feeRaw) : null;
  const configured = String(env.INDIA_DELIVERY_PINCODES || "500052").split(",").map(x => x.trim()).filter(Boolean);
  const deliveryPincodes = [...new Set(configured.filter(pin => INDIA_PINCODES.includes(pin)))];
  const gstStatus = ["registered", "not_registered"].includes(env.INDIA_GST_STATUS) ? env.INDIA_GST_STATUS : "unconfigured";
  const paymentGateway = env.INDIA_PAYMENT_GATEWAY === "razorpay" ? "razorpay" : "unconfigured";
  const configuredMethods = String(env.INDIA_PAYMENT_METHODS || "").split(",").map(x => x.trim().toLowerCase());
  const paymentMethods = [...new Set(configuredMethods.filter(method => method === "cod" || (method === "razorpay" && paymentGateway === "razorpay")))];
  return { deliveryFeePaise, deliveryPincodes, paymentMethods, gstStatus, paymentGateway };
}

export function calculateIndiaTotals(subtotalPaise, deliveryFeePaise, taxRateBps = 0) {
  for (const [name, value] of [["subtotal", subtotalPaise], ["delivery fee", deliveryFeePaise], ["tax rate", taxRateBps]]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  if (taxRateBps > 10000) throw new RangeError("tax rate exceeds 100%");
  const taxBasePaise = subtotalPaise + deliveryFeePaise;
  const taxPaise = Math.round(taxBasePaise * taxRateBps / 10000);
  const totalPaise = taxBasePaise + taxPaise;
  if (![taxBasePaise, taxPaise, totalPaise].every(Number.isSafeInteger) || totalPaise > 2000000000) throw new RangeError("order total exceeds supported limit");
  return { tax_base_paise: taxBasePaise, tax_paise: taxPaise, total_paise: totalPaise };
}
