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


customerAuthRouter.get("/orders", async (req, res, next) => {
  const auth = req.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to view your orders." });
  try {
    const claims = jwt.verify(auth.slice(7), process.env.JWT_SECRET, {
      issuer: "bf-shoes-api", audience: "bf-shoes-customer"
    });
    if (claims.typ !== "customer" || !claims.sub) return res.status(401).json({ error: "Invalid customer session." });
    const result = await pool.query(
      `SELECT o.order_number,o.status,o.payment_status,o.currency,o.subtotal_cents,
        o.delivery_fee_cents,o.vat_cents,o.total_cents,o.created_at,
        COALESCE(json_agg(json_build_object(
          'product_name',oi.product_name,'sku',oi.sku,'size',oi.size_label,
          'color',oi.color_name,'quantity',oi.quantity,'line_total_cents',oi.line_total_cents
        )) FILTER (WHERE oi.id IS NOT NULL),'[]'::json) AS items
       FROM orders o
       JOIN customer_accounts c ON lower(c.email)=lower(o.customer_email)
       LEFT JOIN order_items oi ON oi.order_id=o.id
       WHERE c.id=$1 AND c.active=true
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [claims.sub]
    );
    return res.json({ data: result.rows });
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") return res.status(401).json({ error: "Your session expired. Please sign in again." });
    next(err);
  }
});


const returnRequestSchema = z.object({
  order_number: z.string().trim().regex(/^\\d+$/).max(30),
  request_type: z.enum(["return","exchange"]),
  reason: z.string().trim().min(2).max(120),
  details: z.string().trim().max(1000).optional().default("")
}).strict();

function readCustomerClaims(req, res) {
  const auth = req.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Sign in to manage return or exchange requests." });
    return null;
  }
  try {
    const claims = jwt.verify(auth.slice(7), process.env.JWT_SECRET, {
      issuer: "bf-shoes-api", audience: "bf-shoes-customer"
    });
    if (claims.typ !== "customer" || !claims.sub) {
      res.status(401).json({ error: "Invalid customer session." });
      return null;
    }
    return claims;
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      res.status(401).json({ error: "Your session expired. Please sign in again." });
      return null;
    }
    throw err;
  }
}

// Customer-owned India return/exchange request. This records a request only:
// no refund, replacement shipment, fee or stock movement is performed.
customerAuthRouter.post("/returns", async (req, res, next) => {
  const parsed = returnRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid order number, request type and reason." });
  let claims;
  try { claims = readCustomerClaims(req, res); } catch (err) { return next(err); }
  if (!claims) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `SELECT o.id,o.order_number,o.status,o.currency
       FROM orders o
       JOIN customer_accounts c ON lower(c.email)=lower(o.customer_email)
       WHERE o.order_number=$1 AND c.id=$2 AND c.active=true
       FOR UPDATE OF o`,
      [parsed.data.order_number, claims.sub]
    );
    if (!order.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found for this customer account." });
    }
    const row = order.rows[0];
    if (row.currency !== "INR") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Return and exchange requests are currently available for India orders only." });
    }
    if (row.status !== "delivered") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A return or exchange request can be submitted after the order is delivered." });
    }
    const active = await client.query(
      "SELECT id FROM return_requests WHERE order_id=$1 AND status NOT IN ('rejected','closed') LIMIT 1 FOR UPDATE",
      [row.id]
    );
    if (active.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An active return or exchange request already exists for this order." });
    }
    const created = await client.query(
      `INSERT INTO return_requests(order_id,customer_id,request_type,reason,details)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,request_type,reason,details,status,created_at`,
      [row.id, claims.sub, parsed.data.request_type, parsed.data.reason, parsed.data.details]
    );
    await client.query(
      "INSERT INTO return_request_events(return_request_id,actor_type,actor_id,status,note) VALUES($1,'customer',$2,'requested','Request submitted by customer.')",
      [created.rows[0].id, claims.sub]
    );
    await client.query("COMMIT");
    return res.status(201).json({
      data: { ...created.rows[0], order_number: row.order_number },
      message: "Request submitted for BF SHOES review. No refund or return fee has been charged."
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally { client.release(); }
});

customerAuthRouter.get("/returns", async (req, res, next) => {
  let claims;
  try { claims = readCustomerClaims(req, res); } catch (err) { return next(err); }
  if (!claims) return;
  try {
    const result = await pool.query(
      `SELECT r.id,o.order_number,r.request_type,r.reason,r.details,r.status,r.review_note,r.created_at,r.updated_at,
        COALESCE(json_agg(json_build_object(
          'status',e.status,'note',e.note,'actor_type',e.actor_type,'created_at',e.created_at
        ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL),'[]'::json) AS events
       FROM return_requests r
       JOIN orders o ON o.id=r.order_id
       JOIN customer_accounts c ON c.id=r.customer_id
       LEFT JOIN return_request_events e ON e.return_request_id=r.id
       WHERE c.id=$1 AND c.active=true
       GROUP BY r.id,o.order_number
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [claims.sub]
    );
    res.set("Cache-Control", "no-store");
    return res.json({ data: result.rows });
  } catch (err) { return next(err); }
});
