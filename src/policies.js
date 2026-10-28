import crypto from "node:crypto";

export const STAFF_SCOPES = Object.freeze(["products:read", "inventory:read", "orders:read", "analytics:read", "campaigns:read"]);
export const MANAGER_SCOPES = Object.freeze(["products:read", "products:write", "inventory:read", "inventory:write", "orders:read", "orders:write", "analytics:read", "campaigns:read", "campaigns:write"]);

export function scopesForAdminRole(role) {
  if (role === "admin") return ["*"];
  if (role === "manager") return [...MANAGER_SCOPES];
  if (role === "staff") return [...STAFF_SCOPES];
  return [];
}

export function canTransitionOrder(from, to) {
  const transitions = {
    confirmed: new Set(["processing", "cancelled"]),
    processing: new Set(["shipped", "cancelled"]),
    shipped: new Set(["delivered"]),
    delivered: new Set(),
    cancelled: new Set()
  };
  return transitions[from]?.has(to) ?? false;
}

export function orderRequestFingerprint(order) {
  const canonical = {
    customer_name: order.customer_name,
    customer_email: order.customer_email.toLowerCase(),
    items: order.items.map(({ sku, quantity }) => ({ sku, quantity }))
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
