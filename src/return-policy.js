/**
 * No India return/exchange fee has been approved or configured by the owner.
 * This helper deliberately returns no charge even after eligibility review.
 * The customer/admin request workflow must never create a fee automatically.
 */
export const INDIA_RETURN_FEE_PAISE = null;

export function calculateIndiaReturnFee({ eligible, country = "IN" } = {}) {
  if (country !== "IN") throw new RangeError("India return review applies to India orders only");
  if (typeof eligible !== "boolean") throw new TypeError("Return eligibility must be explicitly reviewed");
  return {
    eligible,
    country,
    fee_paise: null,
    payer: "none",
    charged_at: "not_configured_without_owner_approval"
  };
}
