import crypto from "node:crypto";

export function paytabsConfigured() {
  return process.env.PAYTABS_ENABLED === "true" &&
    Boolean(process.env.PAYTABS_PROFILE_ID) &&
    Boolean(process.env.PAYTABS_SERVER_KEY) &&
    Boolean(publicBaseUrl());
}

function publicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export function paytabsEndpoint() {
  return process.env.PAYTABS_ENV === "production"
    ? "https://secure.paytabs.com"
    : "https://secure.paytabs.com";
}

export function paytabsSignatureValid(rawBody, signature, key = process.env.PAYTABS_SERVER_KEY) {
  if (!key || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", key).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function createPaytabsPayment(payload) {
  if (!paytabsConfigured()) throw new Error("PayTabs credentials or HTTPS callback URL are not configured");
  const response = await fetch(paytabsEndpoint() + "/payment/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": process.env.PAYTABS_SERVER_KEY },
    body: JSON.stringify({ ...payload, profile_id: process.env.PAYTABS_PROFILE_ID })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.redirect_url || !data.tran_ref) {
    throw new Error("PayTabs did not create a hosted payment session");
  }
  return data;
}

export async function verifyPaytabsPayment(tranRef, expectedCartId, expectedAmount, expectedCurrency) {
  if (!paytabsConfigured()) throw new Error("PayTabs credentials are not configured");
  const response = await fetch(paytabsEndpoint() + "/payment/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": process.env.PAYTABS_SERVER_KEY },
    body: JSON.stringify({ profile_id: process.env.PAYTABS_PROFILE_ID, tran_ref: tranRef })
  });
  const data = await response.json().catch(() => ({}));
  const amount = Number(data.cart_amount);
  const verified = response.ok &&
    data.tran_ref === tranRef &&
    String(data.cart_id) === String(expectedCartId) &&
    data.cart_currency === expectedCurrency &&
    Number.isFinite(amount) && Math.round(amount * 100) === expectedAmount &&
    data.payment_result?.response_status === "A";
  return { verified, data };
}
