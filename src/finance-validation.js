import { z } from "zod";

const financeCurrencySchema = z.enum(["INR", "AED"]).default("INR");

export function parseFinanceCurrency(value) {
  return financeCurrencySchema.safeParse(value);
}
