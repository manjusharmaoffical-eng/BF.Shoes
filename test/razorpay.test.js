import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  razorpayConfigured, razorpayPaymentSignature, verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature, createRazorpayOrder, fetchRazorpayPayment, razorpayPublicKey
} from "../src/razorpay.js";

test("Razorpay remains disabled until explicit enablement, credentials and HTTPS base URL exist", () => {
  assert.equal(razorpayConfigured({ RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret", PUBLIC_BASE_URL: "https://bf-shoes.vercel.app" }), false);
  assert.equal(razorpayConfigured({ RAZORPAY_ENABLED: "true", RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret", PUBLIC_BASE_URL: "http://bf-shoes.vercel.app" }), false);
  assert.equal(razorpayConfigured({ RAZORPAY_ENABLED: "true", RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret", PUBLIC_BASE_URL: "https://bf-shoes.vercel.app" }), true);
});

test("Razorpay checkout signature binds the server order ID to the payment ID", () => {
  const signature = razorpayPaymentSignature("order_123", "pay_456", "secret");
  assert.equal(signature, crypto.createHmac("sha256", "secret").update("order_123|pay_456").digest("hex"));
  assert.equal(verifyRazorpayPaymentSignature({ orderId: "order_123", paymentId: "pay_456", signature, secret: "secret" }), true);
  assert.equal(verifyRazorpayPaymentSignature({ orderId: "order_other", paymentId: "pay_456", signature, secret: "secret" }), false);
  assert.equal(verifyRazorpayPaymentSignature({ orderId: "order_123", paymentId: "pay_456", signature: "bad", secret: "secret" }), false);
});

test("Razorpay webhook signature validates the exact raw request body", () => {
  const raw = Buffer.from('{"event":"payment.captured"}');
  const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");
  assert.equal(verifyRazorpayWebhookSignature(raw, signature, "webhook-secret"), true);
  assert.equal(verifyRazorpayWebhookSignature(Buffer.from(raw.toString() + " "), signature, "webhook-secret"), false);
  assert.equal(verifyRazorpayWebhookSignature(raw, signature, "wrong-secret"), false);
});

test("Razorpay server creates only exact INR paise orders and validates provider response", async () => {
  const env = { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "secret" };
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ id: "order_123456", amount: 74900, currency: "INR", status: "created" }) };
  };
  const order = await createRazorpayOrder({ amountPaise: 74900, receipt: "BF-123", notes: { source: "bf-shoes" }, env, fetchImpl });
  assert.equal(sent.url, "https://api.razorpay.com/v1/orders");
  assert.equal(sent.body.amount, 74900);
  assert.equal(sent.body.currency, "INR");
  assert.equal(sent.body.receipt, "BF-123");
  assert.equal(sent.init.headers.Authorization, "Basic " + Buffer.from("rzp_test_key:secret").toString("base64"));
  assert.equal(order.id, "order_123456");
  await assert.rejects(() => createRazorpayOrder({ amountPaise: 74900.5, receipt: "BF-123", env, fetchImpl }), /positive integer/);
  await assert.rejects(() => createRazorpayOrder({ amountPaise: 74900, receipt: "invalid", env, fetchImpl }), /receipt is invalid/);
  await assert.rejects(() => createRazorpayOrder({ amountPaise: 74900, receipt: "BF-123", env, fetchImpl: async () => ({ ok: true, json: async () => ({ id: "order_123456", amount: 1, currency: "INR", status: "created" }) }) }), /mismatched order/);
});

test("Razorpay payment fetch accepts only payment IDs and exposes the configured public key", async () => {
  let url;
  const result = await fetchRazorpayPayment("pay_123", { env: { RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret" }, fetchImpl: async value => { url = value; return { ok: true, json: async () => ({ id: "pay_123", status: "captured" }) }; } });
  assert.equal(url, "https://api.razorpay.com/v1/payments/pay_123");
  assert.equal(result.status, "captured");
  assert.equal(razorpayPublicKey({ RAZORPAY_KEY_ID: "rzp_test_public" }), "rzp_test_public");
  await assert.rejects(() => fetchRazorpayPayment("not-a-payment", { env: { RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret" } }), /payment ID is invalid/);
});


test("payment ledger schema accepts Razorpay without removing historical providers", async () => {
  const { readFile } = await import("node:fs/promises");
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(schema, /provider IN \('payu','paytabs','binance','razorpay'\)/);
});
