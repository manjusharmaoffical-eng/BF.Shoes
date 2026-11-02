export function calculateIndiaGst({
  subtotalCents,
  deliveryFeeCents,
  taxRateBps,
  treatment,
  pricesTaxInclusive,
  deliveryFeeTaxable
}) {
  for (const [name,value] of Object.entries({subtotalCents,deliveryFeeCents,taxRateBps})) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + " must be a non-negative safe integer");
  }
  if (taxRateBps > 10000) throw new RangeError("taxRateBps cannot exceed 10000");
  if (!["INTRA_STATE","INTER_STATE","ZERO_RATED","EXEMPT"].includes(treatment)) throw new TypeError("Invalid India GST treatment");
  if (typeof pricesTaxInclusive !== "boolean" || typeof deliveryFeeTaxable !== "boolean") throw new TypeError("Explicit tax inclusion and delivery taxability are required");
  const taxableBaseCents = subtotalCents + (deliveryFeeTaxable ? deliveryFeeCents : 0);
  if (!Number.isSafeInteger(taxableBaseCents)) throw new RangeError("Taxable base exceeds safe integer range");
  const taxCents = ["ZERO_RATED","EXEMPT"].includes(treatment)
    ? 0
    : Math.round(taxableBaseCents * taxRateBps / (pricesTaxInclusive ? 10000 + taxRateBps : 10000));
  const cgstCents = treatment === "INTRA_STATE" ? Math.floor(taxCents / 2) : 0;
  const sgstCents = treatment === "INTRA_STATE" ? taxCents - cgstCents : 0;
  const igstCents = treatment === "INTER_STATE" ? taxCents : 0;
  const totalCents = subtotalCents + deliveryFeeCents + (pricesTaxInclusive ? 0 : taxCents);
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("Order total exceeds safe integer range");
  return { taxableBaseCents, taxCents, cgstCents, sgstCents, igstCents, totalCents };
}
