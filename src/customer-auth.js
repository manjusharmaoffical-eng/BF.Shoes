import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";

export const customerAuthRouter = express.Router();

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200)
    .refine(v => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v),
      "Use at least 12 characters with upper/lowercase letters and a number")
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200)
}).strict();

const DUMMY_HASH = await bcrypt.hash("Not-a-real-customer-password-9381", 12);

const COOKIE_NAME = "bf_customer_session";
const SESSION_SECONDS = 2 * 60 * 60;
const cookieOptions = req => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || req.secure,
  sameSite: "lax",
  path: "/api/v1/customer-auth",
  maxAge: SESSION_SECONDS * 1000
});
function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
  }
  return "";
}
function requireJwtSecret() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) throw new Error("JWT_SECRET must be at least 32 bytes");
}
async function createCustomerSession(customer, res, req) {
  requireJwtSecret();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await pool.query("INSERT INTO customer_sessions(id,customer_id,expires_at) VALUES($1,$2,$3)", [sessionId, customer.id, expiresAt]);
  const token = jwt.sign({ typ: "customer" }, process.env.JWT_SECRET, {
    subject: customer.id, jwtid: sessionId, expiresIn: SESSION_SECONDS,
    issuer: "bf-shoes-api", audience: "bf-shoes-customer"
  });
  res.cookie(COOKIE_NAME, token, cookieOptions(req));
  return token;
}
function clearCustomerCookie(res, req) {
  const options = cookieOptions(req);
  delete options.maxAge;
  res.clearCookie(COOKIE_NAME, options);
}
export async function getCustomerSession(req) {
  const authorization = req.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const token = bearer || readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: "bf-shoes-api", audience: "bf-shoes-customer" });
  if (claims.typ !== "customer" || !claims.sub || !claims.jti) return null;
  const result = await pool.query(
    "SELECT c.id,c.name,c.email,c.created_at,c.active,s.id AS session_id FROM customer_sessions s JOIN customer_accounts c ON c.id=s.customer_id WHERE s.id=$1 AND s.customer_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()",
    [claims.jti, claims.sub]
  );
  const row = result.rows[0];
  if (!row?.active) return null;
  return { row, claims };
}
function publicCustomer(row) {
  return { id: row.id, name: row.name, email: row.email, created_at: row.created_at };
}

customerAuthRouter.post("/register", async (req, res, next) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please enter a valid name, email, and password (12+ characters with upper/lowercase and a number)." });
  try {
    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query(
      "INSERT INTO customer_accounts(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,created_at",
      [parsed.data.name, email, passwordHash]
    );
    const customer = result.rows[0];
    const accessToken = await createCustomerSession(customer, res, req);
    return res.status(201).json({ customer: publicCustomer(customer), access_token: accessToken, expires_in: SESSION_SECONDS });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    next(err);
  }
});

customerAuthRouter.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  try {
    const email = parsed.data.email.toLowerCase();
    const result = await pool.query(
      "SELECT id,name,email,password_hash,created_at,active FROM customer_accounts WHERE email=$1",
      [email]
    );
    const row = result.rows[0];
    const valid = await bcrypt.compare(parsed.data.password, row?.password_hash || DUMMY_HASH);
    if (!row || !valid || !row.active) return res.status(401).json({ error: "Invalid email or password." });
    const accessToken = await createCustomerSession(row, res, req);
    return res.json({ customer: publicCustomer(row), access_token: accessToken, expires_in: SESSION_SECONDS });
  } catch (err) { next(err); }
});

customerAuthRouter.get("/me", async (req, res, next) => {
  try {
    const session = await getCustomerSession(req);
    if (!session) {
      clearCustomerCookie(res, req);
      return res.status(401).json({ error: "Sign in to view your account." });
    }
    return res.json({ customer: publicCustomer(session.row) });
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      clearCustomerCookie(res, req);
      return res.status(401).json({ error: "Your session expired. Please sign in again." });
    }
    next(err);
  }
});

customerAuthRouter.post("/logout", async (req, res, next) => {
  try {
    const session = await getCustomerSession(req).catch(err => {
      if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") return null;
      throw err;
    });
    if (session) await pool.query("UPDATE customer_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [session.claims.jti]);
    clearCustomerCookie(res, req);
    return res.status(204).end();
  } catch (err) { next(err); }
});

customerAuthRouter.get("/orders", async (req, res, next) => {
  try {
    const session = await getCustomerSession(req);
    if (!session) return res.status(401).json({ error: "Sign in to view your orders." });
    const result = await pool.query(
      `SELECT o.order_number,o.status,o.payment_status,o.currency,o.subtotal_cents,
        o.delivery_fee_cents,o.vat_cents,o.total_cents,o.created_at,
        COALESCE(json_agg(json_build_object(
          'id',oi.id,'product_name',oi.product_name,'sku',oi.sku,'size',oi.size_label,
          'color',oi.color_name,'quantity',oi.quantity,'line_total_cents',oi.line_total_cents
        )) FILTER (WHERE oi.id IS NOT NULL),'[]'::json) AS items
       FROM orders o
       JOIN customer_accounts c ON lower(c.email)=lower(o.customer_email)
       LEFT JOIN order_items oi ON oi.order_id=o.id
       WHERE c.id=$1 AND c.active=true
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [session.row.id]
    );
    return res.json({ data: result.rows });
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") return res.status(401).json({ error: "Your session expired. Please sign in again." });
    next(err);
  }
});
