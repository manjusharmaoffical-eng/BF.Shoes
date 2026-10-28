import test from "node:test";
import assert from "node:assert/strict";
import { calculateIndiaReturnFee, INDIA_RETURN_FEE_PAISE } from "../src/return-policy.js";

test("eligible India return charges customer ₹100 in paise", () => {
  assert.equal(INDIA_RETURN_FEE_PAISE, 10_000);
  assert.deepEqual(calculateIndiaReturnFee({ eligible: true }), {
    eligible: true,
    currency: "INR",
    fee_paise: 10_000,
    payer: "customer",
    charged_at: "after_return_eligibility_review"
  });
});

test("ineligible return has no return fee", () => {
  assert.deepEqual(calculateIndiaReturnFee({ eligible: false }), {
    eligible: false,
    currency: "INR",
    fee_paise: 0,
    payer: "none",
    charged_at: "after_return_eligibility_review"
  });
});

test("return eligibility must be explicitly reviewed", () => {
  assert.throws(() => calculateIndiaReturnFee({}), /explicitly reviewed/);
});

test("policy rejects non-India return processing", () => {
  assert.throws(() => calculateIndiaReturnFee({ eligible: true, country: "AE" }), /India returns only/);
});
