import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db.js";
import { authenticate, requireScope, checkPassword } from "./auth.js";
import { ALL_SCOPES, createAccessToken, hashSecret, newApiKey } from "./security.js";
import { canTransitionOrder, orderRequestFingerprint } from "./policies.js";

export const router = express.Router();

const DUMMY_PASSWORD_HASH = await bcrypt.hash("not-a-real-bf-shoes-password", 12);

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200)
});
router.post("/auth/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid login input" });
    const email = parsed.data.email.toLowerCase();
    const result = await pool.query(
      "SELECT id, email, password_hash, role, active FROM admins WHERE email = $1",
      [email]
    );
    const admin = result.rows[0];
    // A dummy hash comparison reduces obvious timing differences for unknown emails.
    const hash = admin?.password_hash || DUMMY_PASSWORD_HASH;
    const valid = await checkPassword(parsed.data.password, hash);
    if (!admin || !valid || !admin.active) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ access_token: createAccessToken(admin), token_type: "Bearer", expires_in: 900 });
  } catch (err) { next(err); }
});

router.get("/auth/me", authenticate, (req, res) => {
  res.json({ actor: { type: req.actor.type, id: req.actor.id, role: req.actor.role, scopes: req.actor.scopes } });
});

const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(14).max(200)
}).strict().refine(v => v.current_password !== v.new_password, { message: "New password must differ from current password" });
router.post("/auth/change-password", authenticate, async (req, res, next) => {
  if (req.actor.type !== "admin") return res.status(403).json({ error: "Admin account required" });
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid password change", details: parsed.error.flatten() });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const found = await client.query("SELECT id, password_hash, active FROM admins WHERE id=$1 FOR UPDATE", [req.actor.id]);
    const admin = found.rows[0];
    if (!admin?.active) { await client.query("ROLLBACK"); return res.status(401).json({ error: "Admin account inactive" }); }
    if (!(await checkPassword(parsed.data.current_password, admin.password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const passwordHash = await bcrypt.hash(parsed.data.new_password, 12);
    await client.query("UPDATE admins SET password_hash=$1 WHERE id=$2", [passwordHash, admin.id]);
    await client.query("INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES('admin',$1,'admin.password_change','admin',$1::text)", [admin.id]);
    await client.query("COMMIT");
    res.json({ message: "Password changed. Sign out and sign in again; existing access tokens expire within 15 minutes." });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client?.release(); }
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  description: z.string().max(5000).optional().default(""),
  short_description: z.string().max(500).optional().default(""),
  seo_title: z.string().max(200).optional().default(""),
  seo_description: z.string().max(320).optional().default(""),
  brand: z.string().trim().max(100).optional().default("BF SHOES"),
  image_url: z.string().url().max(2000).refine(value => value.startsWith("https://"), "Image URL must use HTTPS").optional().nullable().default(null),
  price_cents: z.number().int().min(0).max(100000000),
  unit_cost_cents: z.number().int().min(0).max(100000000).optional().nullable(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional().default("AED")
});
router.get("/products", authenticate, requireScope("products:read"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, COALESCE(json_agg(json_build_object(
        'id', v.id, 'sku', v.sku, 'size_label', v.size_label,
        'color_name', v.color_name, 'stock_qty', v.stock_qty, 'active', v.active
      )) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
       FROM products p LEFT JOIN variants v ON v.product_id = p.id
       WHERE ($1::boolean OR p.active = true)
       GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`,
      [req.actor.role === "admin"]
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post("/products", authenticate, requireScope("products:write"), async (req, res, next) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product", details: parsed.error.flatten() });
  const p = parsed.data;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO products(name, slug, description, short_description, seo_title, seo_description, brand, image_url, price_cents, unit_cost_cents, currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [p.name, p.slug, p.description, p.short_description, p.seo_title, p.seo_description, p.brand, p.image_url, p.price_cents, p.unit_cost_cents ?? null, p.currency.toUpperCase()]
    );
    await client.query(
      "INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES($1,$2,$3,$4,$5)",
      [req.actor.type, req.actor.id, "product.create", "product", result.rows[0].id]
    );
    await client.query("COMMIT");
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: "Product slug already exists" });
    next(err);
  } finally { client?.release(); }
});

const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(5000).optional(),
  short_description: z.string().max(500).optional(),
  seo_title: z.string().max(200).optional(),
  seo_description: z.string().max(320).optional(),
  price_cents: z.number().int().min(0).max(100000000).optional(),
  unit_cost_cents: z.number().int().min(0).max(100000000).nullable().optional(),
  image_url: z.string().url().max(2000).refine(v => v.startsWith("https://")).nullable().optional(),
  active: z.boolean().optional()
}).strict().refine(v => Object.keys(v).length > 0);
router.patch("/products/:id", authenticate, requireScope("products:write"), async (req,res,next) => {
 const parsed=productUpdateSchema.safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Invalid product update",details:parsed.error.flatten()});
 const entries=Object.entries(parsed.data),values=entries.map(([,v])=>v),sets=entries.map(([k],i)=>`${k}=$${i+1}`);
 values.push(req.params.id);
 try{const result=await pool.query(`UPDATE products SET ${sets.join(", ")},updated_at=now() WHERE id=$${values.length} RETURNING id,name,slug,description,short_description,seo_title,seo_description,brand,image_url,price_cents,unit_cost_cents,currency,active,updated_at`,values);if(!result.rowCount)return res.status(404).json({error:"Product not found"});await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'product.update','product',$3)",[req.actor.type,req.actor.id,result.rows[0].id]);res.json({data:result.rows[0]})}catch(err){next(err)}
});

const variantSchema = z.object({
  sku: z.string().trim().min(2).max(80),
  size_label: z.string().trim().min(1).max(30),
  color_name: z.string().trim().min(1).max(60),
  stock_qty: z.number().int().min(0).max(1000000)
});
router.post("/products/:id/variants", authenticate, requireScope("products:write"), async (req, res, next) => {
  try {
    const parsed = variantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid variant", details: parsed.error.flatten() });
    const v = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const p = await client.query("SELECT id FROM products WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!p.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Product not found" }); }
      const result = await client.query(
        `INSERT INTO variants(product_id, sku, size_label, color_name, stock_qty)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [req.params.id, v.sku, v.size_label, v.color_name, v.stock_qty]
      );
      if (v.stock_qty > 0) await client.query(
        "INSERT INTO inventory_movements(variant_id, delta, reason, actor_admin_id) VALUES($1,$2,$3,$4)",
        [result.rows[0].id, v.stock_qty, "initial_stock", req.actor.type === "admin" ? req.actor.id : null]
      );
      await client.query("COMMIT");
      res.status(201).json({ data: result.rows[0] });
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client?.release(); }
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "SKU or product variant already exists" });
    next(err);
  }
});

router.get("/inventory", authenticate, requireScope("inventory:read"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT v.id, v.sku, v.size_label, v.color_name, v.stock_qty, v.active,
              p.id AS product_id, p.name AS product_name
       FROM variants v JOIN products p ON p.id=v.product_id
       ORDER BY p.name, v.size_label, v.color_name LIMIT 500`
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

const stockSchema = z.object({
  delta: z.number().int().min(-1000000).max(1000000).refine(v => v !== 0),
  reason: z.string().trim().min(3).max(200)
});
router.patch("/inventory/:sku", authenticate, requireScope("inventory:write"), async (req, res, next) => {
  const parsed = stockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid stock adjustment", details: parsed.error.flatten() });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query("SELECT id, stock_qty FROM variants WHERE sku=$1 FOR UPDATE", [req.params.sku]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "SKU not found" }); }
    const nextQty = result.rows[0].stock_qty + parsed.data.delta;
    if (nextQty < 0) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Stock cannot be negative" }); }
    const updated = await client.query(
      "UPDATE variants SET stock_qty=$1, updated_at=now() WHERE id=$2 RETURNING *",
      [nextQty, result.rows[0].id]
    );
    await client.query(
      "INSERT INTO inventory_movements(variant_id, delta, reason, actor_admin_id) VALUES($1,$2,$3,$4)",
      [result.rows[0].id, parsed.data.delta, parsed.data.reason, req.actor.type === "admin" ? req.actor.id : null]
    );
    await client.query("COMMIT");
    res.json({ data: updated.rows[0] });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client?.release(); }
});

const orderSchema = z.object({
  customer_name: z.string().trim().min(1).max(160),
  customer_email: z.string().email().max(254),
  items: z.array(z.object({
    sku: z.string().trim().min(2).max(80),
    quantity: z.number().int().min(1).max(100)
  })).min(1).max(50)
});
router.post("/orders", authenticate, requireScope("orders:write"), async (req, res, next) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order", details: parsed.error.flatten() });
  const suppliedIdempotencyKey = req.get("idempotency-key");
  if (suppliedIdempotencyKey !== undefined && (suppliedIdempotencyKey.length < 1 || suppliedIdempotencyKey.length > 200)) {
    return res.status(400).json({ error: "Idempotency-Key must be between 1 and 200 characters" });
  }
  const idempotencyKey = suppliedIdempotencyKey || null;
  const fingerprint = orderRequestFingerprint({
    ...parsed.data,
    customer_email: parsed.data.customer_email.toLowerCase()
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    if (idempotencyKey) {
      // Serialize concurrent requests using the same key before checking for a replay.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-order-idempotency'))",
        [idempotencyKey]
      );
      const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1", [idempotencyKey]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        if (existing.rows[0].request_fingerprint !== fingerprint) {
          return res.status(409).json({ error: "Idempotency-Key was already used for a different request" });
        }
        const replayItems = await client.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [existing.rows[0].id]);
        return res.status(200).json({ data: { ...existing.rows[0], items: replayItems.rows }, idempotent_replay: true });
      }
    }

    const quantities = new Map();
    for (const item of parsed.data.items) quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.quantity);
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id, v.sku, v.size_label, v.color_name, v.stock_qty,
              v.active AS variant_active, p.name AS product_name, p.price_cents, p.unit_cost_cents, p.currency, p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.sku = ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`,
      [skus]
    );
    if (found.rowCount !== skus.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: "One or more SKUs are unknown" }); }
    const bySku = new Map(found.rows.map(r => [r.sku, r]));
    let subtotal = 0;
    for (const [sku, qty] of quantities) {
      const v = bySku.get(sku);
      if (!v.variant_active || !v.product_active) { await client.query("ROLLBACK"); return res.status(409).json({ error: `SKU unavailable: ${sku}` }); }
      if (v.stock_qty < qty) { await client.query("ROLLBACK"); return res.status(409).json({ error: `Insufficient stock for ${sku}`, available: v.stock_qty }); }
      subtotal += v.price_cents * qty;
      if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order total exceeds limit" }); }
    }
    const currency = found.rows[0].currency;
    if (found.rows.some(r => r.currency !== currency)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Mixed currencies are not supported" }); }

    const orderResult = await client.query(
      `INSERT INTO orders(customer_name, customer_email, currency, subtotal_cents, idempotency_key, request_fingerprint)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [parsed.data.customer_name, parsed.data.customer_email.toLowerCase(), currency, subtotal, idempotencyKey, fingerprint]
    );
    const order = orderResult.rows[0];
    const items = [];
    for (const [sku, qty] of quantities) {
      const v = bySku.get(sku);
      await client.query("UPDATE variants SET stock_qty=stock_qty-$1, updated_at=now() WHERE id=$2", [qty, v.variant_id]);
      const lineTotal = v.price_cents * qty;
      const item = await client.query(
        `INSERT INTO order_items(order_id, variant_id, sku, product_name, size_label, color_name, unit_price_cents, quantity, line_total_cents, unit_cost_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [order.id, v.variant_id, sku, v.product_name, v.size_label, v.color_name, v.price_cents, qty, lineTotal, v.unit_cost_cents ?? null]
      );
      await client.query(
        "INSERT INTO inventory_movements(variant_id, delta, reason, reference_order_id) VALUES($1,$2,$3,$4)",
        [v.variant_id, -qty, "order_created", order.id]
      );
      items.push(item.rows[0]);
    }
    await client.query(
      "INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES($1,$2,$3,$4,$5)",
      [req.actor.type, req.actor.id, "order.create", "order", order.id]
    );
    await client.query("COMMIT");
    res.status(201).json({ data: { ...order, items } });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505" && idempotencyKey) {
      const existing = await pool.query("SELECT * FROM orders WHERE idempotency_key=$1", [idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].request_fingerprint !== fingerprint) {
          return res.status(409).json({ error: "Idempotency-Key was already used for a different request" });
        }
        const replayItems = await pool.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [existing.rows[0].id]);
        return res.status(200).json({ data: { ...existing.rows[0], items: replayItems.rows }, idempotent_replay: true });
      }
    }
    next(err);
  } finally { client?.release(); }
});

router.get("/orders", authenticate, requireScope("orders:read"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200");
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.get("/orders/:id", authenticate, requireScope("orders:read"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Order not found" });
    const items = await pool.query("SELECT * FROM order_items WHERE order_id=$1", [req.params.id]);
    res.json({ data: { ...result.rows[0], items: items.rows } });
  } catch (err) { next(err); }
});

const statusSchema = z.object({
  status: z.enum(["processing", "shipped", "delivered", "cancelled"])
});
router.patch("/orders/:id/status", authenticate, requireScope("orders:write"), async (req, res, next) => {
  if (req.actor.type !== "admin" || !["admin", "manager"].includes(req.actor.role)) {
    return res.status(403).json({ error: "Owner or manager permission required to change order status" });
  }
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order status" });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const orderRes = await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!orderRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Order not found" }); }
    const old = orderRes.rows[0];
    const nextStatus = parsed.data.status;
    if (!canTransitionOrder(old.status, nextStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Invalid order status transition: ${old.status} -> ${nextStatus}` });
    }
    if (nextStatus === "cancelled") {
      const items = await client.query("SELECT variant_id, quantity FROM order_items WHERE order_id=$1 ORDER BY variant_id", [old.id]);
      for (const item of items.rows) {
        await client.query("UPDATE variants SET stock_qty=stock_qty+$1, updated_at=now() WHERE id=$2", [item.quantity, item.variant_id]);
        await client.query(
          "INSERT INTO inventory_movements(variant_id, delta, reason, reference_order_id, actor_admin_id) VALUES($1,$2,$3,$4,$5)",
          [item.variant_id, item.quantity, "order_cancelled", old.id, req.actor.id]
        );
      }
    }
    const updated = await client.query(
      "UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 RETURNING *",
      [nextStatus, old.id]
    );
    await client.query(
      "INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES($1,$2,$3,$4,$5)",
      [req.actor.type, req.actor.id, "order.status_change", "order", old.id]
    );
    await client.query("COMMIT");
    res.json({ data: updated.rows[0] });
  } catch (err) { if (client) await client.query("ROLLBACK").catch(() => {}); next(err); }
  finally { client?.release(); }
});

router.post("/admin/api-keys", authenticate, requireScope("keys:write"), async (req, res, next) => {
  if (req.actor.type !== "admin" || !["admin", "manager"].includes(req.actor.role)) {
    return res.status(403).json({ error: "Only a logged-in administrator can issue API keys" });
  }
  const schema = z.object({
    label: z.string().trim().min(2).max(100),
    scopes: z.array(z.enum(ALL_SCOPES)).min(1).max(ALL_SCOPES.length),
    expires_at: z.string().datetime().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid API key request", details: parsed.error.flatten() });
  const key = newApiKey();
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO api_keys(label, key_prefix, key_hash, scopes, expires_at, created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id, label, key_prefix, scopes, expires_at, created_at`,
      [parsed.data.label, key.prefix, hashSecret(key.raw), [...new Set(parsed.data.scopes)], parsed.data.expires_at || null, req.actor.id]
    );
    await client.query(
      "INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES($1,$2,$3,$4,$5)",
      ["admin", req.actor.id, "api_key.create", "api_key", result.rows[0].id]
    );
    await client.query("COMMIT");
    res.status(201).json({ data: { ...result.rows[0], secret: key.raw, warning: "Copy now. The secret will not be shown again." } });
  } catch (err) { if (client) await client.query("ROLLBACK").catch(() => {}); next(err); }
  finally { client?.release(); }
});

router.get("/admin/api-keys", authenticate, requireScope("keys:write"), async (req, res, next) => {
  try {
    if (req.actor.type !== "admin" || !["admin", "manager"].includes(req.actor.role)) return res.status(403).json({ error: "Admin login required" });
    const result = await pool.query(
      "SELECT id, label, key_prefix, scopes, active, expires_at, created_at, last_used_at FROM api_keys ORDER BY created_at DESC"
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post("/admin/api-keys/:id/revoke", authenticate, requireScope("keys:write"), async (req, res, next) => {
  if (req.actor.type !== "admin" || !["admin", "manager"].includes(req.actor.role)) {
    return res.status(403).json({ error: "Admin login required" });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE api_keys SET active=false WHERE id=$1 AND active=true RETURNING id, label, active",
      [req.params.id]
    );
    if (!result.rowCount) {
      const exists = await client.query("SELECT id FROM api_keys WHERE id=$1", [req.params.id]);
      await client.query("ROLLBACK");
      if (!exists.rowCount) return res.status(404).json({ error: "API key not found" });
      return res.status(409).json({ error: "API key is already revoked" });
    }
    await client.query(
      "INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES($1,$2,$3,$4,$5)",
      ["admin", req.actor.id, "api_key.revoke", "api_key", req.params.id]
    );
    await client.query("COMMIT");
    res.json({ data: result.rows[0] });
  } catch (err) { if (client) await client.query("ROLLBACK").catch(() => {}); next(err); }
  finally { client?.release(); }
});
