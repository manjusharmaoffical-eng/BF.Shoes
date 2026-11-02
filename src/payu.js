import crypto from "node:crypto";

export function payuConfigured() {
  return process.env.PAYU_ENABLED === "true" &&
    Boolean(process.env.PAYU_MERCHANT_KEY) &&
    Boolean(process.env.PAYU_MERCHANT_SALT) &&
    Boolean(publicBaseUrl());
}

export function publicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export function payuPaymentUrl() {
  return process.env.PAYU_ENV === "production"
    ? "https://secure.payu.in/_payment"
    : "https://test.payu.in/_payment";
}

export function payuSha512(value) {
  return crypto.createHash("sha512").update(value, "utf8").digest("hex");
}

export function payuRequestHash(fields, salt) {
  const values = [
    fields.key, fields.txnid, fields.amount, fields.productinfo, fields.firstname,
    fields.email, fields.udf1 || "", fields.udf2 || "", fields.udf3 || "",
    fields.udf4 || "", fields.udf5 || "", "", "", "", "", "", "", salt
  ];
  return payuSha512(values.join("|"));
}

export function payuResponseHash(fields, salt) {
  const values = [
    ...(fields.additionalCharges ? [String(fields.additionalCharges)] : []),
    salt, fields.status || "", "", "", "", "", "",
    fields.udf5 || "", fields.udf4 || "", fields.udf3 || "",
    fields.udf2 || "", fields.udf1 || "", fields.email || "",
    fields.firstname || "", fields.productinfo || "", fields.amount || "",
    fields.txnid || "", fields.key || ""
  ];
  return payuSha512(values.join("|"));
}

export function safeHashEqual(expected, received) {
  if (typeof received !== "string" || !/^[a-f0-9]{128}$/i.test(received)) return false;
  const a = Buffer.from(expected.toLowerCase(), "hex");
  const b = Buffer.from(received.toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function amountToCents(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

export async function verifyPayuPayment(txnid, expectedAmountCents) {
  const key = process.env.PAYU_MERCHANT_KEY;
  const salt = process.env.PAYU_MERCHANT_SALT;
  if (!key || !salt) throw new Error("PayU merchant credentials are not configured");
  const command = "verify_payment";
  const hash = payuSha512([key, command, txnid, salt].join("|"));
  const endpoint = process.env.PAYU_ENV === "production"
    ? "https://info.payu.in/merchant/postservice.php?form=2"
    : "https://test.payu.in/merchant/postservice.php?form=2";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key, command, var1: txnid, hash })
  });
  if (!response.ok) throw new Error("PayU verification service is unavailable");
  const data = await response.json();
  const transaction = data?.transaction_details?.[txnid];
  const verified = transaction?.status === "success" &&
    transaction?.unmappedstatus === "captured" &&
    transaction?.txnid === txnid &&
    amountToCents(transaction?.amt ?? transaction?.amount) === expectedAmountCents;
  return { verified, providerPaymentId: transaction?.mihpayid || null, status: transaction?.unmappedstatus || transaction?.status || "unknown" };
}
