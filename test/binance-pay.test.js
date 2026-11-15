import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  binancePayConfigured,
  binancePaySignature,
  binanceWebhookPayload,
  verifyBinanceWebhookSignature
} from "../src/binance-pay.js";

test("Binance Pay request signature follows timestamp/nonce/body HMAC-SHA512 format", () => {
  const timestamp = "1700000000000";
  const nonce = "0123456789abcdef0123456789abcdef";
  const body = '{"merchantTradeNo":"BF123","currency":"AED"}';
  const expected = createHmac("sha512", "secret")
    .update(timestamp + "\n" + nonce + "\n" + body + "\n")
    .digest("hex").toUpperCase();
  assert.equal(binancePaySignature(timestamp, nonce, body, "secret"), expected);
  assert.notEqual(
    binancePaySignature(timestamp, nonce, body, "secret"),
    binancePaySignature(timestamp, nonce, body, "other-secret")
  );
});

test("Binance Pay stays disabled unless explicitly enabled with keys and AED currency", () => {
  assert.equal(binancePayConfigured({ BINANCE_API_KEY: "key", BINANCE_SECRET_KEY: "secret", BINANCE_PAY_CURRENCY: "AED" }), false);
  assert.equal(binancePayConfigured({ BINANCE_PAY_ENABLED: "true", BINANCE_API_KEY: "key", BINANCE_SECRET_KEY: "secret", BINANCE_PAY_CURRENCY: "AED" }), true);
  assert.equal(binancePayConfigured({ BINANCE_PAY_ENABLED: "true", BINANCE_API_KEY: "key", BINANCE_SECRET_KEY: "secret", BINANCE_PAY_CURRENCY: "USDT" }), false);
});

test("Binance Pay webhook verifies RSA-SHA256 over the exact raw body", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const timestamp = String(Date.now());
  const nonce = "0123456789abcdef0123456789abcdef";
  const rawBody = Buffer.from('{"bizType":"PAY","bizStatus":"PAY_SUCCESS","data":"{}"}');
  const signer = createSign("RSA-SHA256");
  signer.update(binanceWebhookPayload(timestamp, nonce, rawBody));
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");
  assert.equal(verifyBinanceWebhookSignature({ timestamp, nonce, rawBody, signature, publicKey }), true);
  assert.equal(verifyBinanceWebhookSignature({ timestamp, nonce, rawBody: Buffer.from(rawBody.toString() + " "), signature, publicKey }), false);
  assert.equal(verifyBinanceWebhookSignature({ timestamp, nonce, rawBody, signature: "bad", publicKey }), false);
});

test("UAE storefront routes hosted checkout through PayTabs and keeps it gated", async () => {
  const [storefront, frontend, html, schema, helper] = await Promise.all([
    readFile(new URL("../src/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../frontend/app.js", import.meta.url), "utf8"),
    readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
    readFile(new URL("../schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/binance-pay.js", import.meta.url), "utf8")
  ]);
  assert.match(storefront, /storefrontRouter\.post\("\/orders\/binance"/);
  assert.match(storefront, /storefrontRouter\.post\("\/payments\/binance\/webhook"/);
  assert.match(helper, /BINANCE_PAY_ENABLED/);
  assert.match(helper, /\/binancepay\/openapi\/v2\/order/);
  assert.match(helper, /fiatAmount: Number\(amount\)/);
  assert.match(helper, /fiatCurrency: "AED"/);
  assert.doesNotMatch(helper, /orderAmount: Number\(amount\),\s*currency: "AED"/);
  assert.match(frontend, /API_BASE \+ '\/orders\/binance'/);
  assert.match(frontend, /https:\/\/pay\.binance\.com\//);
  assert.match(html, /id="payment-paytabs-option"/);
  assert.match(schema, /razorpay/);
});

test("Binance Pay AED order uses V2 fiatAmount/fiatCurrency and validates quote", async () => {
  const { createBinancePayOrder } = await import("../src/binance-pay.js");
  const env = { BINANCE_API_KEY: "serial", BINANCE_SECRET_KEY: "secret", BINANCE_PAY_CURRENCY: "AED" };
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({ status: "SUCCESS", code: "000000", data: {
        prepayId: "1234567890123456789", checkoutUrl: "https://pay.binance.com/checkout/test",
        currency: "USDT", totalFee: "27.12345678", fiatCurrency: "AED", fiatAmount: "100.00", expireTime: 1794719999999
      } })
    };
  };
  const result = await createBinancePayOrder({
    merchantTradeNo: "BF12345", amount: "100.00", description: "BF SHOES order",
    returnUrl: "https://bf-shoes.vercel.app/payment-result.html?order=12345", env, fetchImpl
  });
  assert.equal(sent.url, "https://bpay.binanceapi.com/binancepay/openapi/v2/order");
  assert.equal(sent.body.fiatCurrency, "AED");
  assert.equal(sent.body.fiatAmount, 100);
  assert.equal(sent.body.currency, undefined);
  assert.equal(sent.body.orderAmount, undefined);
  assert.equal(sent.body.goods.goodsCategory, "3000");
  assert.equal(result.currency, "USDT");
  await assert.rejects(() => createBinancePayOrder({
    merchantTradeNo: "BF12346", amount: "100.00", description: "BF SHOES order",
    returnUrl: "https://bf-shoes.vercel.app/payment-result.html?order=12346", env,
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "SUCCESS", code: "000000", data: {
      prepayId: "1234567890123456788", checkoutUrl: "https://pay.binance.com/checkout/test",
      currency: "USDT", totalFee: "27.12", fiatCurrency: "USD", fiatAmount: "100.00"
    } }) })
  }), /invalid or unverifiable AED checkout session/);
});
