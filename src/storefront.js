import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { deliverEmail } from "./email.js";
import { parseIndiaMarketEnv, calculateIndiaTotals } from "./india-market-policy.js";

export const storefrontRouter = express.Router();

const checkoutSchema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_email: z.string().trim().email().max(254),
  customer_phone: z.string().trim().min(7).max(30).regex(/^[+()0-9 .-]+$/),
  shipping_address: z.string().trim().min(10).max(1000),
  shipping_country: z.literal("IN"),
  shipping_pincode: z.literal("500052"),
  payment_method: z.literal("cod"),
  items: z.array(z.object({ sku: z.string().trim().min(2).max(80), quantity: z.number().int().min(1).max(10) })).min(1).max(20)
}).strict();

storefrontRouter.get("/campaigns/active", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, headline, image_url, target_url, coupon_code, discount_percent
       FROM campaigns
       WHERE status = 'active' AND kind = 'banner'
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at IS NULL OR ends_at > now())
       ORDER BY updated_at DESC
       LIMIT 5`
    );
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.json({ data: result.rows });
  } catch (err) {
    // Keep the public storefront available if the optional campaign migration
    // has not been applied to this environment yet. An empty campaign table
    // already returns [] naturally; other database failures must remain visible.
    if (err.code === "42P01" && /campaigns/i.test(err.message || "")) {
      res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      return res.json({ data: [] });
    }
    return next(err);
  }
});

storefrontRouter.get("/products", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.brand,
        COALESCE(to_jsonb(p)->>'category','shoes') AS category,
        COALESCE(to_jsonb(p)->>'audience','unisex') AS audience,
        COALESCE(to_jsonb(p)->>'product_type','general') AS product_type,
        COALESCE(to_jsonb(p)->'attributes','{}'::jsonb) AS attributes,
        p.price_cents, p.currency, p.image_url, (p.currency <> 'INR') AS price_pending_conversion,
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


async function getIndiaMarketConfig(db = pool) {
  const env = parseIndiaMarketEnv(process.env);
  const reasons = [];
  if (env.deliveryFeePaise === null || !Number.isSafeInteger(env.deliveryFeePaise) || env.deliveryFeePaise < 0 || env.deliveryFeePaise > 2000000000) reasons.push("delivery_fee_not_configured");
  if (!env.deliveryPincodes.includes("500052")) reasons.push("pin_500052_not_configured");
  if (env.gstStatus === "unconfigured") reasons.push("gst_status_not_confirmed");
  const currencies = await db.query("SELECT currency, count(*)::int AS product_count FROM products WHERE active=TRUE GROUP BY currency");
  if (currencies.rows.some(row => row.currency !== "INR" && Number(row.product_count) > 0)) reasons.push("product_price_conversion_required");
  if (!currencies.rows.some(row => row.currency === "INR" && Number(row.product_count) > 0)) reasons.push("no_inr_priced_products");
  if (!env.paymentMethods.length) reasons.push("payment_method_not_confirmed");
  let taxProfile = null, taxRate = 0;
  if (env.gstStatus === "registered") {
    const r = await db.query("SELECT id, currency, tax_rate_bps, registration_number, seller_state FROM tax_profiles WHERE jurisdiction='IN_GST' AND active=TRUE ORDER BY created_at DESC LIMIT 2");
    if (r.rowCount !== 1 || r.rows[0].currency !== "INR" || !String(r.rows[0].registration_number || "").trim() || !String(r.rows[0].seller_state || "").trim() || !Number.isSafeInteger(Number(r.rows[0].tax_rate_bps)) || Number(r.rows[0].tax_rate_bps) <= 0 || Number(r.rows[0].tax_rate_bps) > 10000) reasons.push("valid_in_gst_profile_required");
    else { taxProfile = r.rows[0]; taxRate = Number(r.rows[0].tax_rate_bps); }
  }
  const onlineReady = false; // Razorpay server-side order creation, signature verification and webhook handling are not yet implemented.
  return { currency: "INR", country: "IN", delivery_pincodes: env.deliveryPincodes, target_pincode: "500052", delivery_fee_paise: env.deliveryFeePaise, payment_methods: env.paymentMethods, payment_gateway: env.paymentGateway, online_payment_ready: onlineReady, online_payment_note: "Razorpay order creation, signature verification, webhook handling and merchant credentials are required before online payments can be accepted.", gst_status: env.gstStatus, gst_rate_bps: env.gstStatus === "registered" ? (taxProfile ? taxRate : null) : (env.gstStatus === "not_registered" ? 0 : null), checkout_ready: reasons.length === 0, setup_required: [...new Set(reasons)], tax_profile: taxProfile };
}

storefrontRouter.get("/config", async (_req, res, next) => {
  try { const c = await getIndiaMarketConfig(); const { tax_profile, ...publicConfig } = c; res.set("Cache-Control", "no-store"); res.json({ data: publicConfig }); }
  catch (err) { next(err); }
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
      "SELECT order_number, customer_email, status, currency, subtotal_cents, delivery_fee_cents, vat_cents, tax_rate_bps, total_cents, shipping_country, shipping_emirate, created_at, updated_at FROM orders WHERE order_number=$1 AND customer_email=$2",
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
  if (d.shipping_country !== "IN" || d.shipping_pincode !== "500052") return res.status(400).json({ error: "BF SHOES currently supports delivery only to PIN 500052, India." });
  let marketConfig;
  try { marketConfig = await getIndiaMarketConfig(); } catch (err) { return next(err); }
  if (!marketConfig.checkout_ready) return res.status(503).json({ error: "India checkout is not enabled yet. Verify INR product prices, delivery fee and the active GST profile first.", setup_required: marketConfig.setup_required });
  if (!marketConfig.payment_methods.includes(d.payment_method)) return res.status(400).json({ error: "This payment method is not enabled for the store." });
  if (d.payment_method === "online") return res.status(503).json({ error: "Online payment is not live yet. Configure and verify the payment gateway before accepting online payments." });
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
      return res.status(200).json({ data: { order_number: existing.rows[0].order_number, status: existing.rows[0].status, subtotal_cents: existing.rows[0].subtotal_cents, delivery_fee_cents: existing.rows[0].delivery_fee_cents, total_cents: existing.rows[0].total_cents, currency: existing.rows[0].currency }, idempotent_replay: true });
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

    if (currency !== "INR") { await client.query("ROLLBACK"); return res.status(400).json({ error: "India checkout only accepts verified INR-priced products. Existing prices have not been converted." }); }
    const deliveryFee = marketConfig.delivery_fee_paise;
    const taxRate = marketConfig.gst_rate_bps || 0;
    let totals;
    try { totals = calculateIndiaTotals(subtotal, deliveryFee, taxRate); }
    catch { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order total exceeds limit" }); }
    const vatCents = totals.tax_paise;
    const total = totals.total_paise;
    const paymentMethod = d.payment_method;
    const inserted = await client.query(
      `INSERT INTO orders(customer_name, customer_email, customer_phone, shipping_address, payment_method,
         currency, subtotal_cents, delivery_fee_cents, vat_cents, tax_rate_bps, shipping_country, shipping_emirate,
         total_cents, idempotency_key, request_fingerprint)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'IN','',$11,$12,$13)
       RETURNING order_number, status, subtotal_cents, delivery_fee_cents, vat_cents, tax_rate_bps, total_cents, currency, shipping_country, shipping_emirate, created_at`,
      [d.customer_name, d.customer_email.toLowerCase(), d.customer_phone, `${d.shipping_address}, PIN ${d.shipping_pincode}, India`, paymentMethod, currency, subtotal, deliveryFee, vatCents, taxRate, total, idempotencyKey, requestFingerprint]
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
      await deliverEmail({ kind: "order_confirmation", recipient: d.customer_email.toLowerCase(), subject: `BF SHOES order #${order.order_number} confirmed`, textBody: `Hi ${d.customer_name},\
\
Your BF SHOES order #${order.order_number} has been received.\
Total: ${order.currency} ${(Number(order.total_cents) / 100).toFixed(2)}\
Payment: ${order.payment_method === "cod" ? "Cash on Delivery" : "Online"}\
\
We will update you as your order progresses.` });
    } catch { /* order is committed; notification delivery is non-blocking */ }
    res.status(201).json({ data: order });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client?.release(); }
});
