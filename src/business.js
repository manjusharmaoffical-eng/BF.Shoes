import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db.js";
import { authenticate, requireScope } from "./auth.js";

export const businessRouter = express.Router();
businessRouter.use(authenticate);

function ownerOnly(req, res, next) {
  if (req.actor.type !== "admin" || req.actor.role !== "admin") {
    return res.status(403).json({ error: "Owner permission required" });
  }
  next();
}
const roleScopes = {
  manager: ["products:read", "products:write", "inventory:read", "inventory:write", "orders:read", "orders:write", "analytics:read", "campaigns:read", "campaigns:write"],
  staff: ["products:read", "inventory:read", "orders:read", "analytics:read", "campaigns:read"]
};

// Team management: only the owner may create, deactivate, or change staff roles.
businessRouter.get("/team", ownerOnly, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, email, role, active, created_at FROM admins ORDER BY created_at DESC");
    res.json({ data: result.rows.map(row => ({ ...row, role: row.role === "admin" ? "owner" : row.role })) });
  } catch (err) { next(err); }
});
businessRouter.post("/team", ownerOnly, async (req, res, next) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(14).max(200),
    role: z.enum(["manager", "staff"])
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid email, password (14+ characters), and role" });
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query(
      "INSERT INTO admins(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role,active,created_at",
      [parsed.data.email.toLowerCase(), hash, parsed.data.role]
    );
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('admin',$1,'team.member.create','admin',$2)", [req.actor.id, result.rows[0].id]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
    next(err);
  }
});
businessRouter.patch("/team/:id", ownerOnly, async (req, res, next) => {
  const schema = z.object({ active: z.boolean().optional(), role: z.enum(["manager", "staff"]).optional() }).strict().refine(v => Object.keys(v).length > 0);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide active and/or role" });
  try {
    const fields = [], values = [];
    if (parsed.data.active !== undefined) { values.push(parsed.data.active); fields.push("active=$" + values.length); }
    if (parsed.data.role !== undefined) { values.push(parsed.data.role); fields.push("role=$" + values.length); }
    values.push(req.params.id);
    const result = await pool.query("UPDATE admins SET " + fields.join(", ") + " WHERE id=$" + values.length + " AND role <> 'admin' RETURNING id,email,role,active,created_at", values);
    if (!result.rowCount) return res.status(404).json({ error: "Team member not found or owner account cannot be changed here" });
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('admin',$1,'team.member.update','admin',$2)", [req.actor.id, req.params.id]);
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// Campaigns and promotional banners. Campaigns are records; ad-network spend/attribution
// still requires an external advertising account and its API credentials.
const campaignSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(["banner", "coupon", "sale", "ad"]),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  headline: z.string().trim().max(200).optional().default(""),
  image_url: z.string().url().max(2000).refine(v => v.startsWith("https://")).optional().nullable(),
  target_url: z.string().url().max(2000).refine(v => v.startsWith("https://")).optional().nullable(),
  coupon_code: z.string().trim().max(40).optional().default(""),
  discount_percent: z.number().int().min(0).max(90).default(0),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  budget_cents: z.number().int().min(0).max(1000000000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default("AED")
}).strict().refine(v => !v.starts_at || !v.ends_at || new Date(v.ends_at) > new Date(v.starts_at), { message: "Campaign end must be after start" });
businessRouter.get("/campaigns", requireScope("campaigns:read"), async (_req, res, next) => {
  try { const result = await pool.query("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 200"); res.json({ data: result.rows }); }
  catch (err) { next(err); }
});
businessRouter.post("/campaigns", requireScope("campaigns:write"), async (req, res, next) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid campaign", details: parsed.error.flatten() });
  const c = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO campaigns(name,kind,status,headline,image_url,target_url,coupon_code,discount_percent,starts_at,ends_at,budget_cents,currency,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [c.name,c.kind,c.status,c.headline,c.image_url || null,c.target_url || null,c.coupon_code.toUpperCase(),c.discount_percent,c.starts_at || null,c.ends_at || null,c.budget_cents,c.currency,req.actor.id]
    );
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'campaign.create','campaign',$3)", [req.actor.type,req.actor.id,result.rows[0].id]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});
businessRouter.patch("/campaigns/:id", requireScope("campaigns:write"), async (req, res, next) => {
  const schema = z.object({ status: z.enum(["draft","active","paused","ended"]).optional(), name: z.string().trim().min(2).max(160).optional(), budget_cents: z.number().int().min(0).max(1000000000).optional() }).strict().refine(v => Object.keys(v).length > 0);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid campaign update" });
  const entries = Object.entries(parsed.data), values = entries.map(([,value]) => value);
  const sets = entries.map(([key],i) => key + "=$" + (i+1));
  values.push(req.params.id);
  try {
    const result = await pool.query("UPDATE campaigns SET " + sets.join(", ") + ", updated_at=now() WHERE id=$" + values.length + " RETURNING *", values);
    if (!result.rowCount) return res.status(404).json({ error: "Campaign not found" });
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'campaign.update','campaign',$3)", [req.actor.type,req.actor.id,result.rows[0].id]);
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// High-level reporting. Revenue here is order value, not profit; COGS/ad spend are not yet connected.
businessRouter.get("/analytics", requireScope("analytics:read"), async (_req, res, next) => {
  try {
    const [summary, daily, top, inventory] = await Promise.all([
      pool.query(`SELECT count(*)::int AS orders,
        count(*) FILTER (WHERE status='delivered')::int AS delivered_orders,
        count(*) FILTER (WHERE status='cancelled')::int AS cancelled_orders,
        COALESCE(sum(subtotal_cents) FILTER (WHERE status <> 'cancelled'),0)::bigint AS gross_order_value_cents,
        COALESCE(sum(subtotal_cents) FILTER (WHERE status='delivered'),0)::bigint AS delivered_value_cents
        FROM orders`),
      pool.query(`SELECT date_trunc('day',created_at)::date AS day,count(*)::int AS orders,
        COALESCE(sum(subtotal_cents),0)::bigint AS order_value_cents FROM orders
        WHERE created_at >= now()-interval '30 days' AND status <> 'cancelled'
        GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT oi.product_name,sum(oi.quantity)::int AS units_sold,
        sum(oi.line_total_cents)::bigint AS order_value_cents FROM order_items oi
        JOIN orders o ON o.id=oi.order_id WHERE o.status <> 'cancelled'
        GROUP BY oi.product_name ORDER BY units_sold DESC LIMIT 10`),
      pool.query("SELECT count(*)::int AS variants, COALESCE(sum(stock_qty),0)::bigint AS units_in_stock FROM variants WHERE active=true")
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ data: { summary: summary.rows[0], daily: daily.rows, top_products: top.rows, inventory: inventory.rows[0], note: "Order value is not profit. Product costs, advertising spend, taxes, refunds and delivery fees are not yet included." } });
  } catch (err) { next(err); }
});

// Bulk variant creation validates the whole batch and commits atomically.
businessRouter.post("/products/:id/variants/bulk", requireScope("products:write"), async (req, res, next) => {
  const schema = z.object({ variants: z.array(z.object({
    sku: z.string().trim().min(2).max(80),
    size_label: z.string().trim().min(1).max(30),
    color_name: z.string().trim().min(1).max(60),
    stock_qty: z.number().int().min(0).max(1000000)
  }).strict()).min(1).max(100) }).strict().refine(({variants}) => new Set(variants.map(v => v.sku)).size === variants.length, { message: "SKUs must be unique within the batch" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid variant batch", details: parsed.error.flatten() });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const product = await client.query("SELECT id FROM products WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!product.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Product not found" }); }
    const created = [];
    for (const v of parsed.data.variants) {
      const row = await client.query("INSERT INTO variants(product_id,sku,size_label,color_name,stock_qty) VALUES($1,$2,$3,$4,$5) RETURNING *", [req.params.id,v.sku,v.size_label,v.color_name,v.stock_qty]);
      if (v.stock_qty > 0) await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,actor_admin_id) VALUES($1,$2,'initial_stock',$3)", [row.rows[0].id,v.stock_qty,req.actor.type === "admin" ? req.actor.id : null]);
      created.push(row.rows[0]);
    }
    await client.query("COMMIT");
    res.status(201).json({ data: created });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: "A SKU or size/color variant already exists; no variants were added" });
    next(err);
  } finally { client?.release(); }
});


// Owner-only audit trail and staff performance reporting (activity counts, orders processed).
businessRouter.get("/activity", ownerOnly, async (req, res, next) => {
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid limit" });
  try {
    const result = await pool.query(
      `SELECT e.id,e.actor_type,e.actor_id,a.email,a.role,e.action,e.resource_type,e.resource_id,e.created_at
       FROM audit_events e LEFT JOIN admins a ON e.actor_type='admin' AND a.id=e.actor_id
       ORDER BY e.created_at DESC LIMIT $1`, [parsed.data.limit]
    );
    res.set("Cache-Control", "no-store");
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});
businessRouter.get("/performance", ownerOnly, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.id,a.email,a.role,a.active,
        count(e.id)::int AS recorded_actions,
        count(e.id) FILTER (WHERE e.action LIKE 'order.%' OR e.action LIKE 'storefront.order.%')::int AS order_actions,
        max(e.created_at) AS last_activity
       FROM admins a LEFT JOIN audit_events e ON e.actor_type='admin' AND e.actor_id=a.id
       GROUP BY a.id ORDER BY recorded_actions DESC,a.email`
    );
    res.set("Cache-Control", "no-store");
    res.json({ data: result.rows, note: "Performance reflects recorded audit actions only; it is not a measure of employee quality or customer satisfaction." });
  } catch (err) { next(err); }
});
