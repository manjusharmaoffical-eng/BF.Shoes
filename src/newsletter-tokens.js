import { createHmac, timingSafeEqual } from "node:crypto";

function signingKey() {
  const secret = process.env.JWT_SECRET || "";
  if (Buffer.byteLength(secret) < 32) throw new Error("JWT_SECRET must be at least 32 bytes");
  return secret;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createNewsletterUnsubscribeToken(email, now = Date.now()) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
    throw new Error("A valid subscriber email is required");
  }
  const payload = Buffer.from(JSON.stringify({
    email: normalized,
    exp: Math.floor(now / 1000) + 365 * 24 * 60 * 60
  })).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyNewsletterUnsubscribeToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 1200) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = createHmac("sha256", signingKey()).update(parts[0]).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof payload.email !== "string" || !EMAIL_PATTERN.test(payload.email) ||
        payload.email.length > 254 || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) return null;
    return payload.email.toLowerCase();
  } catch { return null; }
}
