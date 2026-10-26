import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
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

function customerToken(customer) {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }
  return jwt.sign({ typ: "customer" }, process.env.JWT_SECRET, {
    subject: customer.id, expiresIn: "2h", issuer: "bf-shoes-api", audience: "bf-shoes-customer"
  });
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
    return res.status(201).json({ customer: publicCustomer(customer), access_token: customerToken(customer), token_type: "Bearer", expires_in: 7200 });
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
    return res.json({ customer: publicCustomer(row), access_token: customerToken(row), token_type: "Bearer", expires_in: 7200 });
  } catch (err) { next(err); }
});

customerAuthRouter.get("/me", async (req, res, next) => {
  const auth = req.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to view your account." });
  try {
    const claims = jwt.verify(auth.slice(7), process.env.JWT_SECRET, {
      issuer: "bf-shoes-api", audience: "bf-shoes-customer"
    });
    if (claims.typ !== "customer" || !claims.sub) return res.status(401).json({ error: "Invalid customer session." });
    const result = await pool.query(
      "SELECT id,name,email,created_at,active FROM customer_accounts WHERE id=$1",
      [claims.sub]
    );
    const row = result.rows[0];
    if (!row?.active) return res.status(401).json({ error: "Customer account is unavailable." });
    return res.json({ customer: publicCustomer(row) });
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") return res.status(401).json({ error: "Your session expired. Please sign in again." });
    next(err);
  }
});
