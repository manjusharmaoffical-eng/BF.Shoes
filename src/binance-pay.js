import { createHmac, createVerify, randomBytes, timingSafeEqual } from "node:crypto";

const API_BASE = "https://bpay.binanceapi.com";

export function binancePayConfigured(env = process.env) {
  return Boolean(env.BINANCE_PAY_ENABLED === "true" && env.BINANCE_API_KEY && env.BINANCE_SECRET_KEY && env.BINANCE_PAY_CURRENCY === "AED");
}

export function binancePaySignature(timestamp, nonce, body, secret) {
  const payload = String(timestamp) + "\n" + nonce + "\n" + body + "\n";
  return createHmac("sha512", secret).update(payload, "utf8").digest("hex").toUpperCase();
}

export function binanceWebhookPayload(timestamp, nonce, rawBody) {
  return String(timestamp) + "\n" + nonce + "\n" + Buffer.from(rawBody).toString("utf8") + "\n";
}

export function verifyBinanceWebhookSignature({ timestamp, nonce, rawBody, signature, publicKey }) {
  if (!timestamp || !nonce || !signature || !publicKey || !rawBody) return false;
  if (!/^\d{13}$/.test(String(timestamp)) || !/^[A-Za-z0-9]{32}$/.test(String(nonce))) return false;
  let received;
  try { received = Buffer.from(String(signature), "base64"); } catch { return false; }
  if (!received.length) return false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(binanceWebhookPayload(timestamp, nonce, rawBody), "utf8");
    verifier.end();
    return verifier.verify(publicKey, received);
  } catch { return false; }
}

function credentials(env = process.env) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET_KEY) {
    throw new Error("Binance Pay API credentials are not configured in this environment");
  }
  return { apiKey: env.BINANCE_API_KEY, secret: env.BINANCE_SECRET_KEY };
}

export async function binancePayRequest(path, body, { env = process.env, fetchImpl = fetch } = {}) {
  const { apiKey, secret } = credentials(env);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const serialized = JSON.stringify(body);
  const signature = binancePaySignature(timestamp, nonce, serialized, secret);
  const response = await fetchImpl(API_BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "BinancePay-Timestamp": timestamp,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": apiKey,
      "BinancePay-Signature": signature
    },
    body: serialized,
    signal: AbortSignal.timeout(12000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.status !== "SUCCESS" || result.code !== "000000") {
    const code = result?.code || response.status;
    throw new Error("Binance Pay API request failed (" + code + ")");
  }
  return result.data || {};
}

export async function createBinancePayOrder({ merchantTradeNo, amount, description, returnUrl, env = process.env, fetchImpl = fetch }) {
  if (env.BINANCE_PAY_CURRENCY !== "AED") {
    throw new Error("Set BINANCE_PAY_CURRENCY to AED only after Binance confirms AED checkout support for this merchant.");
  }
  const data = await binancePayRequest("/binancepay/openapi/v2/order", {
    env: { terminalType: "WEB" },
    merchantTradeNo,
    fiatAmount: Number(amount),
    fiatCurrency: "AED",
    goods: {
      goodsType: "01",
      goodsCategory: "3000",
      referenceGoodsId: String(merchantTradeNo),
      goodsName: "BF SHOES order",
      goodsDetail: String(description).slice(0, 256)
    },
    returnUrl
  }, { env, fetchImpl });
  if (!data.prepayId || !data.checkoutUrl || !/^https:\/\/pay\.binance\.com\//.test(data.checkoutUrl) ||
      data.fiatCurrency !== "AED" || Math.abs(Number(data.fiatAmount) - Number(amount)) > 0.000001 ||
      !data.currency || !Number.isFinite(Number(data.totalFee)) || Number(data.totalFee) <= 0) {
    throw new Error("Binance Pay returned an invalid or unverifiable AED checkout session");
  }
  return data;
}

export async function queryBinancePayOrder(merchantTradeNo, options = {}) {
  return binancePayRequest("/binancepay/openapi/order/query", { merchantTradeNo }, options);
}

export async function getBinancePayCertificate(certificateSerial, options = {}) {
  const data = await binancePayRequest("/binancepay/openapi/certificates", {}, options);
  const entries = Array.isArray(data) ? data : Array.isArray(data.certificates) ? data.certificates : [data];
  const match = entries.find(item => String(item.certSerial || "").toLowerCase() === String(certificateSerial || "").toLowerCase());
  if (!match?.certPublic) throw new Error("Binance Pay webhook certificate was not found");
  return match.certPublic;
}
