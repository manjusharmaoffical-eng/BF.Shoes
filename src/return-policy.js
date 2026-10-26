/**
 * BF SHOES India return-fee policy.
 * Amounts are stored in paise to avoid floating-point currency math.
 * This policy helper is not wired into checkout: return fees are assessed only
 * after a return request is reviewed, never charged as an upfront order fee.
 */
export const INDIA_RETURN_FEE_PAISE = 10_000; // ₹100.00

export function calculateIndiaReturnFee({ eligible, country = "IN" } = {}) {
  if (country !== "IN") {
    throw new RangeError("BF SHOES currently supports India returns only");
  }
  if (typeof eligible !== "boolean") {
    throw new TypeError("Return eligibility must be explicitly reviewed");
  }
  return {
    eligible,
    currency: "INR",
    fee_paise: eligible ? INDIA_RETURN_FEE_PAISE : 0,
    payer: eligible ? "customer" : "none",
    charged_at: "after_return_eligibility_review"
  };
}
