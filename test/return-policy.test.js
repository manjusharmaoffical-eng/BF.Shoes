import test from "node:test";
import assert from "node:assert/strict";
import { calculateIndiaReturnFee, INDIA_RETURN_FEE_PAISE } from "../src/return-policy.js";

test("eligible India return has no fee until the owner explicitly configures one", () => {
  assert.equal(INDIA_RETURN_FEE_PAISE, null);
  assert.deepEqual(calculateIndiaReturnFee({ eligible: true }), {
    eligible: true, country: "IN", fee_paise: null, payer: "none",
    charged_at: "not_configured_without_owner_approval"
  });
});

test("ineligible India return also has no fee", () => {
  assert.equal(calculateIndiaReturnFee({ eligible: false }).fee_paise, null);
  assert.equal(calculateIndiaReturnFee({ eligible: false }).payer, "none");
});

test("return eligibility must be explicitly reviewed", () => {
  assert.throws(() => calculateIndiaReturnFee({}), /explicitly reviewed/);
});

test("India return fee helper rejects UAE orders", () => {
  assert.throws(() => calculateIndiaReturnFee({ eligible: true, country: "AE" }), /India orders only/);
});
