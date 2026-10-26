import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { deliverEmail } from "./email.js";

export const storefrontRouter = express.Router();

const checkoutSchema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_email: z.string().trim().email().max(254),
  customer_phone: z.string().trim().min(7).max(30).regex(/^[+()0-9 .-]+$/),
  shipping_address: z.string().trim().min(10).max(1000),
  shipping_country: z.enum(["AE"]).default("AE"),
  shipping_pincode: z.string().trim().optional().default(""),
  items: z.array(z.object({ sku: z.string().trim().min(2).max(80), quantity: z.number().int().min(1).max(10) })).min(1).max(20)
}).strict();

storefrontRouter.get("/campaigns/active", async (_req,res,next) => {
 try { const result=await pool.query(`SELECT id,name,headline,image_url,target_url,coupon_code,discount_percent FROM campaigns WHERE status='active' AND kind='banner' AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) ORDER BY updated_at DESC LIMIT 5`);res.set("Cache-Control","public, max-age=30, stale-while-revalidate=60");res.json({data:result.rows}) } catch(err){next(err)}
});

storefrontRouter.get("/products", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.short_description, p.seo_title, p.seo_description, p.brand, p.price_cents, p.currency, p.image_url,
        COALESCE(json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_label', v.size_label,
          'color_name', v.color_name, 'stock_qty', v.stock_qty)
          ORDER BY v.size_label) FILTER (WHERE v.id IS NOT NULL AND v.active = true), '[]') AS variants
       FROM products p LEFT JOIN variants v ON v.product_id = p.id
       WHERE p.active = true GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`
    );
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

// Customer self-service tracking: order number plus the exact checkout email.
storefrontRouter.get("/orders/track", async (req, res, next) => {
  const orderNumber = String(req.query.order_number || "").trim();
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!/^\d{1,18}$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid order number and checkout email" });
  }
  try {
    const found = await pool.query(
      "SELECT order_number, customer_email, status, currency, subtotal_cents, created_at, updated_at FROM orders WHERE order_number=$1 AND customer_email=$2",
      [orderNumber, email]
    );
    if (!found.rowCount) return res.status(404).json({ error: "No matching order found. Check your order number and email." });
    const items = await pool.query(
      "SELECT product_name, size_label, color_name, quantity FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_number=$1 AND customer_email=$2)",
      [orderNumber, email]
    );
    res.set("Cache-Control", "no-store");
    res.json({ data: { ...found.rows[0], items: items.rows } });
  } catch (err) { next(err); }
});

storefrontRouter.post("/orders", async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your checkout details", details: parsed.error.flatten() });
  const suppliedKey = req.get("idempotency-key");
  if (!suppliedKey || suppliedKey.length < 16 || suppliedKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(suppliedKey)) {
    return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  }
  const d = parsed.data;
  if (d.shipping_country === "IN") {
    const pin = d.shipping_pincode;
    if (!/^[1-9][0-9]{5}$/.test(pin)) return res.status(400).json({ error: "Enter a valid six-digit Indian PIN code" });
    const allowedPins = new Set((process.env.INDIA_DELIVERY_PINCODES || "500052").split(",").map(value => value.trim()).filter(Boolean));
    if (!allowedPins.size) return res.status(503).json({ error: "India delivery is not configured yet. Please contact the store before ordering." });
    if (!allowedPins.has(pin)) return res.status(400).json({ error: "Sorry, BF SHOES does not deliver to this PIN code yet." });
    // Safety gate: catalog prices are currently AED and orders have no separate INR delivery-fee field.
    return res.status(503).json({ error: "India delivery to this PIN code is planned, but checkout is not enabled yet. INR product pricing and the ₹50 delivery fee must be configured first." });
  } else if (d.shipping_pincode) {
    return res.status(400).json({ error: "PIN code is only used for India delivery. Select the correct delivery country." });
  }
  const idempotencyKey = `store:${suppliedKey}`;
  const requestFingerprint = storefrontRequestFingerprint(d);
  const quantities = aggregateStorefrontItems(d.items);
  if ([...quantities.values()].some(q => q > 10)) return res.status(400).json({ error: "Maximum quantity per size is 10" });

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-order-idempotency'))", [idempotencyKey]);
    const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1", [idempotencyKey]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      if (existing.rows[0].request_fingerprint !== requestFingerprint) {
        return res.status(409).json({ error: "This checkout key was already used for a different order. Refresh your cart and try again." });
      }
      return res.status(200).json({ data: { order_number: existing.rows[0].order_number, status: existing.rows[0].status, subtotal_cents: existing.rows[0].subtotal_cents, currency: existing.rows[0].currency }, idempotent_replay: true });
    }

    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id, v.sku, v.size_label, v.color_name, v.stock_qty,
              v.active AS variant_active, p.name AS product_name, p.price_cents, p.unit_cost_cents, p.currency, p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.sku = ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`, [skus]
    );
    if (found.rowCount !== skus.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: "One or more selected sizes are no longer available" }); }
    const bySku = new Map(found.rows.map(row => [row.sku, row]));
    let subtotal = 0;
    for (const [sku, qty] of quantities) {
      const v = bySku.get(sku);
      if (!v.variant_active || !v.product_active) { await client.query("ROLLBACK"); return res.status(409).json({ error: "A selected item is no longer available" }); }
      if (v.stock_qty < qty) { await client.query("ROLLBACK"); return res.status(409).json({ error: `Not enough stock for ${v.product_name} (size ${v.size_label})`, available: v.stock_qty }); }
      subtotal += Number(v.price_cents) * qty;
      if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order total exceeds limit" }); }
    }
    const currency = found.rows[0].currency;
    if (found.rows.some(v => v.currency !== currency)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Mixed currencies are not supported" }); }

    const inserted = await client.query(
      `INSERT INTO orders(customer_name, customer_email, customer_phone, shipping_address, payment_method,
         currency, subtotal_cents, idempotency_key, request_fingerprint)
       VALUES($1,$2,$3,$4,'cod',$5,$6,$7,$8) RETURNING order_number, status, subtotal_cents, currency, created_at`,
      [d.customer_name, d.customer_email.toLowerCase(), d.customer_phone, `${d.shipping_address}${d.shipping_country === "IN" ? `, India PIN: ${d.shipping_pincode}` : ""}`, currency, subtotal, idempotencyKey, requestFingerprint]
    );
    const order = inserted.rows[0];
    const orderIdResult = await client.query("SELECT id FROM orders WHERE order_number=$1", [order.order_number]);
    const orderId = orderIdResult.rows[0].id;
    for (const [sku, qty] of quantities) {
      const v = bySku.get(sku);
      await client.query("UPDATE variants SET stock_qty=stock_qty-$1, updated_at=now() WHERE id=$2", [qty, v.variant_id]);
      await client.query(
        `INSERT INTO order_items(order_id, variant_id, sku, product_name, size_label, color_name, unit_price_cents, quantity, line_total_cents, unit_cost_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, v.variant_id, sku, v.product_name, v.size_label, v.color_name, v.price_cents, qty, Number(v.price_cents) * qty, v.unit_cost_cents ?? null]
      );
      await client.query("INSERT INTO inventory_movements(variant_id, delta, reason, reference_order_id) VALUES($1,$2,$3,$4)", [v.variant_id, -qty, "storefront_cod_order", orderId]);
    }
    await client.query("INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id) VALUES('system', NULL, 'storefront.order.create', 'order', $1)", [String(orderId)]);
    await client.query("COMMIT");
    // Email is best-effort and must never roll back a committed order.
    try {
      await deliverEmail({ kind: "order_confirmation", recipient: d.customer_email.toLowerCase(), subject: `BF SHOES order #${order.order_number} confirmed`, textBody: `Hi ${d.customer_name},\\n\\nYour BF SHOES order #${order.order_number} has been received.\\nTotal: ${order.currency} ${(Number(order.subtotal_cents) / 100).toFixed(2)}\\nPayment: Cash on Delivery\\n\\nWe will update you as your order progresses.` });
    } catch { /* order is committed; notification delivery is non-blocking */ }
    res.status(201).json({ data: order });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client?.release(); }
});
