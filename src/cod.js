import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { parseIndiaMarketEnv, calculateIndiaTotals } from "./india-market-policy.js";
import { parseUaeMarketEnv, calculateUaeTotals } from "./uae-market-policy.js";
import { allocateOrderWarehouseStock } from "./warehouse-stock.js";

export const codRouter = express.Router();

const schema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_email: z.string().trim().email().max(254),
  customer_phone: z.string().trim().min(7).max(30).regex(/^[+()0-9 .-]+$/),
  shipping_address: z.string().trim().min(10).max(1000),
  shipping_country: z.enum(["IN", "AE"]),
  shipping_pincode: z.string().trim().optional().default(""),
  shipping_emirate: z.string().trim().optional().default(""),
  payment_method: z.literal("cod"),
  items: z.array(z.object({ sku: z.string().trim().min(2).max(80), quantity: z.number().int().min(1).max(10) })).min(1).max(20)
}).strict();

const validIdempotencyKey = value => typeof value === "string" && value.length >= 16 && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value);

export async function getCodMarketReadiness(db = pool, env = process.env) {
  const products = await db.query("SELECT p.currency, count(DISTINCT p.id)::int AS product_count, count(v.id) FILTER (WHERE v.active=true AND v.stock_verified=true AND v.stock_qty>0)::int AS verified_stock_variants FROM products p LEFT JOIN variants v ON v.product_id=p.id AND v.active=true WHERE p.active=true GROUP BY p.currency");
  const hasINR = products.rows.some(row => row.currency === "INR" && Number(row.product_count) > 0 && Number(row.verified_stock_variants) > 0);
  const hasAED = products.rows.some(row => row.currency === "AED" && Number(row.product_count) > 0 && Number(row.verified_stock_variants) > 0);
  const india = parseIndiaMarketEnv(env);
  const uae = parseUaeMarketEnv(env);
  const tax = await db.query(
    "SELECT jurisdiction, count(*)::int AS count, bool_and(currency='INR' AND trim(registration_number)<>'' AND trim(seller_state)<>'' AND tax_rate_bps BETWEEN 1 AND 10000) AS india_valid, bool_and(currency='AED' AND trim(registration_number)<>'' AND tax_rate_bps BETWEEN 1 AND 10000) AS uae_valid, max(tax_rate_bps)::int AS tax_rate_bps FROM tax_profiles WHERE active=true AND jurisdiction IN ('IN_GST','AE_VAT') GROUP BY jurisdiction"
  );
  const indiaTax = tax.rows.find(row => row.jurisdiction === "IN_GST");
  const uaeTax = tax.rows.find(row => row.jurisdiction === "AE_VAT");
  const indiaTaxReady = india.gstStatus === "not_registered" || (india.gstStatus === "registered" && Number(indiaTax?.count) === 1 && indiaTax?.india_valid === true);
  const uaeTaxReady = uae.vatStatus === "not_registered" || (uae.vatStatus === "registered" && Number(uaeTax?.count) === 1 && uaeTax?.uae_valid === true);
  const indiaFee = india.deliveryFeePaise;
  const uaeFee = uae.fee;
  const indiaReady = env.INDIA_COD_ENABLED === "true" && env.INDIA_COD_VERIFIED === "true" &&
    env.INDIA_PRICING_VERIFIED === "true" && hasINR &&
    env.INDIA_DELIVERY_FEE_VERIFIED === "true" && Number.isSafeInteger(indiaFee) && indiaFee >= 0 &&
    india.deliveryPincodes.includes("500052") && indiaTaxReady;
  const uaeReady = env.UAE_COD_ENABLED === "true" && env.UAE_COD_VERIFIED === "true" &&
    env.UAE_PRICING_VERIFIED === "true" && hasAED &&
    env.UAE_DELIVERY_FEE_VERIFIED === "true" && Number.isSafeInteger(uaeFee) && uaeFee >= 0 &&
    uae.configuredEmirates.length > 0 && uaeTaxReady;
  return {
    IN: { enabled: indiaReady, deliveryFee: Number.isSafeInteger(indiaFee) ? indiaFee : null, gstStatus: india.gstStatus, taxRateBps: india.gstStatus === "registered" && indiaTaxReady ? Number(indiaTax.tax_rate_bps) : 0 },
    AE: { enabled: uaeReady, deliveryFee: Number.isSafeInteger(uaeFee) ? uaeFee : null, vatStatus: uae.vatStatus, taxRateBps: uae.vatStatus === "registered" && uaeTaxReady ? Number(uaeTax.tax_rate_bps) : 0, emirates: uae.configuredEmirates }
  };
}

codRouter.post("/orders/cod", async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your COD checkout details", details: parsed.error.flatten() });
  const key = req.get("idempotency-key");
  if (!validIdempotencyKey(key)) return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  const d = parsed.data;
  const market = d.shipping_country;
  if (market === "IN" && d.shipping_pincode !== "500052") return res.status(400).json({ error: "BF SHOES currently delivers only to PIN code 500052." });
  let config;
  try { config = await getCodMarketReadiness(); }
  catch (error) { return next(error); }
  const ready = config[market];
  if (!ready.enabled) return res.status(503).json({ error: market === "IN" ? "India COD is not enabled: owner verification, INR prices, delivery fee and GST setup must be complete." : "UAE COD is not enabled: owner verification, AED prices, delivery fee, emirate coverage and VAT setup must be complete." });
  if (market === "AE" && !ready.emirates.includes(d.shipping_emirate)) return res.status(400).json({ error: "Select a UAE emirate covered by BF SHOES delivery." });

  const quantities = aggregateStorefrontItems(d.items);
  if ([...quantities.values()].some(quantity => quantity > 10)) return res.status(400).json({ error: "Maximum quantity per size is 10" });
  const fingerprint = storefrontRequestFingerprint(d);
  const idempotencyKey = "store:cod:" + key;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-cod-idempotency'))", [idempotencyKey]);
    const previous = await client.query("SELECT id, order_number, request_fingerprint FROM orders WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (previous.rowCount) {
      if (previous.rows[0].request_fingerprint !== fingerprint) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This checkout key was already used for different order details." });
      }
      await client.query("COMMIT");
      return res.status(200).json({ data: { order_number: previous.rows[0].order_number, payment_method: "cod", payment_status: "unpaid", idempotent_replay: true } });
    }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,v.stock_verified,v.active AS variant_active,
        p.name AS product_name,p.price_cents,p.unit_cost_cents,p.currency,p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.sku=ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`, [skus]
    );
    if (found.rowCount !== skus.length) { await client.query("ROLLBACK"); return res.status(409).json({ error: "One or more selected sizes are no longer available." }); }
    const bySku = new Map(found.rows.map(row => [row.sku, row]));
    let subtotal = 0;
    for (const [sku, quantity] of quantities) {
      const item = bySku.get(sku);
      if (!item.variant_active || !item.product_active || item.currency !== (market === "IN" ? "INR" : "AED")) {
        await client.query("ROLLBACK"); return res.status(409).json({ error: "Selected products do not belong to the chosen market or are inactive." });
      }
      if (!item.stock_verified) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Physical stock for " + item.product_name + " size " + item.size_label + " has not been verified." }); }
      if (Number(item.stock_qty) < quantity) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Insufficient stock for " + item.product_name + " size " + item.size_label + "." }); }
      subtotal += Number(item.price_cents) * quantity;
      if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order subtotal exceeds the supported limit." }); }
    }
    const totals = market === "IN"
      ? calculateIndiaTotals(subtotal, ready.deliveryFee, ready.taxRateBps)
      : calculateUaeTotals(subtotal, ready.deliveryFee, ready.taxRateBps);
    const taxAmount = market === "IN" ? totals.tax_paise : totals.vat_fils;
    const total = market === "IN" ? totals.total_paise : totals.total_fils;
    const currency = market === "IN" ? "INR" : "AED";
    const address = d.shipping_address + (market === "IN" ? ", India PIN: " + d.shipping_pincode : ", " + d.shipping_emirate + ", UAE");
    const inserted = await client.query(
      `INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_address,shipping_country,shipping_emirate,
        payment_method,payment_status,status,currency,subtotal_cents,delivery_fee_cents,vat_cents,tax_rate_bps,total_cents,idempotency_key,request_fingerprint)
       VALUES($1,$2,$3,$4,$5,$6,'cod','unpaid','confirmed',$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id,order_number`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,address,market,market === "AE" ? d.shipping_emirate : "",currency,subtotal,ready.deliveryFee,taxAmount,ready.taxRateBps,total,idempotencyKey,fingerprint]
    );
    const order = inserted.rows[0];
    for (const [sku, quantity] of quantities) {
      const item = bySku.get(sku);
      await client.query(
        "INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [order.id,item.variant_id,sku,item.product_name,item.size_label,item.color_name,item.price_cents,quantity,Number(item.price_cents)*quantity,item.unit_cost_cents ?? null]
      );
      await client.query("UPDATE variants SET stock_qty=stock_qty-$1,updated_at=now() WHERE id=$2", [quantity,item.variant_id]);
      await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,reference_order_id) VALUES($1,$2,'storefront_cod_order',$3)", [item.variant_id,-quantity,order.id]);
      await allocateOrderWarehouseStock(client, { orderId: order.id, variantId: item.variant_id, quantity, reason: "storefront_cod_order" });
    }
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'storefront.cod.created','order',$1)", [String(order.id)]);
    await client.query("COMMIT");
    return res.status(201).json({ data: { order_number: order.order_number, payment_method: "cod", payment_status: "unpaid", status: "confirmed", currency, subtotal_cents: subtotal, delivery_fee_cents: ready.deliveryFee, vat_cents: taxAmount, total_cents: total } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});
