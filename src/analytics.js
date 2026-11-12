import { z } from "zod";

const analyticsCurrencySchema = z.enum(["AED", "INR"]).default("AED");

export function parseAnalyticsCurrency(value) {
  return analyticsCurrencySchema.safeParse(value);
}
