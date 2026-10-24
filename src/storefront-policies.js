import crypto from "node:crypto";

export function storefrontRequestFingerprint(data) {
  const canonical = {
    customer_name: data.customer_name.trim(),
    customer_email: data.customer_email.trim().toLowerCase(),
    customer_phone: data.customer_phone.replace(/[ .()-]/g, ""),
    shipping_address: data.shipping_address.trim().replace(/\s+/g, " "),
    payment_method: "cod",
    items: data.items.map(({ sku, quantity }) => ({ sku: sku.trim(), quantity })).sort((a, b) => a.sku.localeCompare(b.sku))
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function aggregateStorefrontItems(items) {
  const quantities = new Map();
  for (const item of items) quantities.set(item.sku.trim(), (quantities.get(item.sku.trim()) || 0) + item.quantity);
  return quantities;
}
