import crypto from "node:crypto";

const API_BASE = "https://api.razorpay.com/v1";

export function razorpayConfigured(env = process.env) {
  return env.RAZORPAY_ENABLED === "true" &&
    Boolean(env.RAZORPAY_KEY_ID) && Boolean(env.RAZORPAY_KEY_SECRET) &&
    Boolean(env.PUBLIC_BASE_URL && /^https:\/\//i.test(env.PUBLIC_BASE_URL));
}

function credentials(env = process.env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay API credentials are not configured in this environment");
  }
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

export function razorpayPaymentSignature(orderId, paymentId, secret) {
  return crypto.createHmac("sha256", secret)
    .update(String(orderId) + "|" + String(paymentId), "utf8").digest("hex");
}

export function verifyRazorpayPaymentSignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !/^pay_[A-Za-z0-9]+$/.test(String(paymentId || "")) ||
      typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const expected = Buffer.from(razorpayPaymentSignature(orderId, paymentId, secret), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export function verifyRazorpayWebhookSignature(rawBody, signature, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  if (!rawBody || !secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function razorpayRequest(path, { method = "GET", body, env = process.env, fetchImpl = fetch } = {}) {
  const { keyId, keySecret } = credentials(env);
  const authorization = "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetchImpl(API_BASE + path, {
    method,
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const code = data?.error?.code || response.status;
    throw new Error("Razorpay API request failed (" + code + ")");
  }
  return data;
}

export async function createRazorpayOrder({ amountPaise, receipt, notes = {}, env = process.env, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 2000000000) {
    throw new TypeError("Razorpay order amount must be a positive integer in paise");
  }
  if (!/^BF-[A-Za-z0-9_-]{1,36}$/.test(String(receipt || ""))) throw new TypeError("Razorpay receipt is invalid");
  const data = await razorpayRequest("/orders", {
    method: "POST", env, fetchImpl,
    body: { amount: amountPaise, currency: "INR", receipt, notes }
  });
  if (!/^order_[A-Za-z0-9]+$/.test(String(data.id || "")) ||
      data.currency !== "INR" || Number(data.amount) !== amountPaise || data.status !== "created") {
    throw new Error("Razorpay returned an invalid or mismatched order");
  }
  return data;
}

export async function fetchRazorpayPayment(paymentId, options = {}) {
  if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || ""))) throw new TypeError("Razorpay payment ID is invalid");
  return razorpayRequest("/payments/" + encodeURIComponent(paymentId), options);
}

export function razorpayPublicKey(env = process.env) {
  return env.RAZORPAY_KEY_ID || null;
}
