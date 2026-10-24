import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const ALL_SCOPES = [
  "products:read", "products:write",
  "inventory:read", "inventory:write",
  "orders:read", "orders:write",
  "keys:write"
];

export function hashSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function createAccessToken(admin) {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }
  return jwt.sign(
    { role: admin.role, typ: "admin" },
    process.env.JWT_SECRET,
    { subject: admin.id, expiresIn: "15m", issuer: "bf-shoes-api", audience: "bf-shoes-admin" }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: "bf-shoes-api", audience: "bf-shoes-admin"
  });
}

export function newApiKey() {
  const secret = crypto.randomBytes(32).toString("base64url");
  return { raw: `bfsk_${secret}`, prefix: `bfsk_${secret.slice(0, 8)}` };
}
