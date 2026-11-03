import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { paytabsSignatureValid } from "../src/paytabs.js";

test("PayTabs callback signature accepts the exact raw-body HMAC", () => {
  const raw = Buffer.from('{"tran_ref":"TST123","cart_id":"BF-123"}');
  const key = "test-server-key";
  const signature = crypto.createHmac("sha256", key).update(raw).digest("hex");
  assert.equal(paytabsSignatureValid(raw, signature, key), true);
});

test("PayTabs callback signature rejects altered payloads and malformed signatures", () => {
  const raw = Buffer.from('{"tran_ref":"TST123","cart_id":"BF-123"}');
  const key = "test-server-key";
  const signature = crypto.createHmac("sha256", key).update(raw).digest("hex");
  assert.equal(paytabsSignatureValid(Buffer.from(raw.toString()+" "), signature, key), false);
  assert.equal(paytabsSignatureValid(raw, "not-a-signature", key), false);
  assert.equal(paytabsSignatureValid(raw, signature, ""), false);
});
