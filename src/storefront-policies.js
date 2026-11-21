import crypto from "node:crypto";

export function storefrontRequestFingerprint(data) {
  const canonical = {
    customer_name: data.customer_name.trim(),
    customer_email: data.customer_email.trim().toLowerCase(),
    customer_phone: data.customer_phone.replace(/[ .()-]/g, ""),
    shipping_address: data.shipping_address.trim().replace(/\s+/g, " "),
    shipping_country: String(data.shipping_country || "IN").trim().toUpperCase(),
    shipping_pincode: String(data.shipping_pincode || "").trim(),
    shipping_emirate: String(data.shipping_emirate || "").trim(),
    payment_method: String(data.payment_method || "cod").trim().toLowerCase(),
    items: data.items.map(({ sku, quantity }) => ({ sku: sku.trim(), quantity })).sort((a, b) => a.sku.localeCompare(b.sku))
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function aggregateStorefrontItems(items) {
  const quantities = new Map();
  for (const item of items) quantities.set(item.sku.trim(), (quantities.get(item.sku.trim()) || 0) + item.quantity);
  return quantities;
}

const UNVERIFIED_PRICE_AMOUNT = /(?:₹\s*|Rs\.?\s*|\bINR\s*|\bAED\s*|د\.إ\s*|Dhs\.?\s*)\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:INR|AED|Rs\.?)/i;
const UNVERIFIED_PRICE_LABEL = /\b(?:verified|owner[-\s]confirmed)\s+(?:(?:india|uae|inr|aed)\s+)?(?:selling\s+)?price\b/i;

function removeUnverifiedPriceSentences(value) {
  const safe = String(value).split(/(?<=[!?])\s+|(?<!Rs\.)(?<!Dhs\.)(?<=\.)\s+/iu)
    .filter(sentence => !UNVERIFIED_PRICE_AMOUNT.test(sentence) && !UNVERIFIED_PRICE_LABEL.test(sentence))
    .join(" ").trim();
  return safe || null;
}

function sanitizeUnverifiedPriceText(value) {
  if (typeof value === "string") return removeUnverifiedPriceSentences(value);
  if (Array.isArray(value)) return value.map(sanitizeUnverifiedPriceText).filter(item => item !== null);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, nested]) => [key, sanitizeUnverifiedPriceText(nested)])
      .filter(([, nested]) => nested !== null));
  }
  return value;
}

/**
 * Removes price claims embedded in descriptive catalog text while market
 * selling prices are still unverified. Numeric prices remain withheld by the
 * API response mapper; this also protects description/attribute fields.
 */
function removeUnverifiedPriceAmounts(value) {
  const pattern = new RegExp(UNVERIFIED_PRICE_AMOUNT.source, "gi");
  const safe = String(value)
    .replace(pattern, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[-–—,:;|]+\s*$/u, "")
    .trim();
  return safe || null;
}

export function hideUnverifiedPriceClaims(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return product;
  const safe = { ...product };

  // Preserve product identity; remove only unverified currency amounts.
  for (const field of ["name", "slug", "brand", "category", "audience", "product_type"]) {
    if (typeof safe[field] === "string") safe[field] = removeUnverifiedPriceAmounts(safe[field]);
  }

  // Descriptive text: remove the complete sentence containing a price claim.
  for (const field of ["description", "short_description"]) {
    if (typeof safe[field] === "string") safe[field] = removeUnverifiedPriceSentences(safe[field]);
  }
  if (safe.attributes && typeof safe.attributes === "object") {
    safe.attributes = sanitizeUnverifiedPriceText(safe.attributes);
  }
  return safe;
}
