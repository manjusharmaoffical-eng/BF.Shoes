import express from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { allocateOrderWarehouseStock } from "./warehouse-stock.js";
import { deliverEmail } from "./email.js";
import { calculateIndiaTotals } from "./india-market-policy.js";
import {
  createRazorpayOrder, fetchRazorpayPayment, razorpayConfigured,
  razorpayPaymentSignature, verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature
} from "./razorpay.js";

export const razorpayStorefrontRouter = express.Router();

const checkoutSchema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_email: z.string().trim().email().max(254),
  customer_phone: z.string().trim().min(7).max(30).regex(/^[+()0-9 .-]+$/),
  shipping_address: z.string().trim().min(10).max(1000),
  shipping_country: z.literal("IN"),
  shipping_pincode: z.string().trim().length(6),
  payment_method: z.literal("razorpay").default("razorpay"),
  items: z.array(z.object({
    sku: z.string().trim().min(2).max(80),
    quantity: z.number().int().min(1).max(10)
  })).min(1).max(20)
}).strict();

function checkoutReadiness() {
  if (process.env.INDIA_CHECKOUT_VERIFIED !== "true") return "India checkout has not been explicitly verified by the owner.";
  if (!razorpayConfigured()) return "Razorpay test credentials and HTTPS public URL are not enabled in this environment.";
  if (process.env.INDIA_PRICING_VERIFIED !== "true") return "India product pricing has not been owner-verified.";
  if (process.env.INDIA_DELIVERY_FEE_VERIFIED !== "true") return "India delivery fee has not been owner-verified.";
  if (!/^\\d+$/.test(process.env.INDIA_DELIVERY_FEE_PAISE || "")) return "India delivery fee is not configured.";
  return null;
}

function checkoutPayload(order, razorpayOrder, customer) {
  return {
    order_number: order.order_number,
    checkout: {
      key: process.env.RAZORPAY_KEY_ID,
      razorpay_order_id: razorpayOrder.id,
      amount: Number(razorpayOrder.amount),
      currency: "INR",
      name: "BF SHOES",
      description: "Order #" + order.order_number,
      prefill: { name: customer.customer_name, email: customer.customer_email, contact: customer.customer_phone },
      theme: { color: "#d71920" }
    }
  };
}

razorpayStorefrontRouter.post("/orders/razorpay", async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your India checkout details", details: parsed.error.flatten() });
  const suppliedKey = req.get("idempotency-key");
  if (!suppliedKey || suppliedKey.length < 16 || suppliedKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(suppliedKey)) {
    return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  }
  const d = parsed.data;
  if (d.shipping_pincode !== "500052") return res.status(400).json({ error: "BF SHOES India delivery is currently limited to PIN code 500052." });
  const blocked = checkoutReadiness();
  if (blocked) return res.status(503).json({ error: blocked + " Checkout remains disabled." });
  const allowedPins = new Set((process.env.INDIA_DELIVERY_PINCODES || "500052").split(",").map(v => v.trim()).filter(Boolean));
  if (!allowedPins.has(d.shipping_pincode)) return res.status(400).json({ error: "Sorry, BF SHOES does not deliver to this PIN code yet." });

  const deliveryFee = Number(process.env.INDIA_DELIVERY_FEE_PAISE);
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || deliveryFee > 2000000000) return res.status(503).json({ error: "India delivery fee is invalid. Checkout remains disabled." });
  const idempotencyKey = "store:" + suppliedKey;
  const fingerprint = storefrontRequestFingerprint(d);
  const quantities = aggregateStorefrontItems(d.items);
  if ([...quantities.values()].some(q => q > 10)) return res.status(400).json({ error: "Maximum quantity per size is 10" });

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-order-idempotency'))", [idempotencyKey]);
    const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (existing.rowCount) {
      const order = existing.rows[0];
      if (order.request_fingerprint !== fingerprint) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This checkout key was already used for a different order." });
      }
      const attempt = await client.query(
        "SELECT status,amount_cents,checkout_params FROM payment_attempts WHERE order_id=$1 AND provider='razorpay' ORDER BY created_at DESC LIMIT 1",
        [order.id]
      );
      await client.query("COMMIT");
      if (order.payment_status === "paid") return res.status(409).json({ error: "This order has already been paid.", order_number: order.order_number });
      if (attempt.rows[0]?.status === "pending") {
        const reservations = await pool.query(
          "SELECT count(*)::int AS total,count(*) FILTER (WHERE expires_at>now())::int AS active FROM order_reservations WHERE order_id=$1",
          [order.id]
        );
        if (reservations.rows[0].total > 0 && reservations.rows[0].active === reservations.rows[0].total) {
          const saved = attempt.rows[0].checkout_params;
          return res.status(200).json({ data: {
            order_number: order.order_number,
            checkout: { ...saved, prefill: { name: d.customer_name, email: d.customer_email, contact: d.customer_phone }, theme: { color: "#d71920" } },
            idempotent_replay: true
          }});
        }
        await pool.query("UPDATE payment_attempts SET status='review' WHERE order_id=$1 AND provider='razorpay' AND status='pending'", [order.id]);
        await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'", [order.id]);
        return res.status(409).json({ error: "The previous payment reservation expired. Start a new checkout session." });
      }
      return res.status(409).json({ error: "A previous payment attempt is no longer pending. Start a fresh checkout session." });
    }

    await client.query("DELETE FROM order_reservations WHERE expires_at<=now()");
    const tax = await client.query(
      "SELECT id,currency,tax_rate_bps,registration_number,seller_state FROM tax_profiles WHERE active=true AND jurisdiction='IN_GST' ORDER BY created_at DESC LIMIT 2"
    );
    if (tax.rowCount !== 1 || tax.rows[0].currency !== "INR" ||
        !String(tax.rows[0].registration_number || "").trim() ||
        !String(tax.rows[0].seller_state || "").trim() ||
        !Number.isSafeInteger(Number(tax.rows[0].tax_rate_bps)) ||
        Number(tax.rows[0].tax_rate_bps) <= 0 || Number(tax.rows[0].tax_rate_bps) > 10000) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "Exactly one valid active India GST profile with registration and seller state is required before checkout." });
    }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,
        COALESCE((SELECT sum(r.quantity) FROM order_reservations r WHERE r.variant_id=v.id AND r.expires_at>now()),0)::int AS reserved_qty,
        v.active AS variant_active,p.name AS product_name,p.price_cents,p.unit_cost_cents,p.currency,p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.sku=ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`,
      [skus]
    );
    if (found.rowCount !== skus.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "One or more selected sizes are no longer available." });
    }
    const bySku = new Map(found.rows.map(row => [row.sku, row]));
    let subtotal = 0;
    for (const [sku, quantity] of quantities) {
      const item = bySku.get(sku);
      if (!item.variant_active || !item.product_active) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "A selected item is no longer available." });
      }
      const available = Number(item.stock_qty) - Number(item.reserved_qty);
      if (available < quantity) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Not enough available stock for " + item.product_name + " (size " + item.size_label + ").", available });
      }
      subtotal += Number(item.price_cents) * quantity;
      if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Order total exceeds limit." });
      }
    }
    if (found.rows.some(item => item.currency !== "INR")) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "Razorpay India checkout requires INR-priced products only." });
    }
    const indiaTotals = calculateIndiaTotals(subtotal, deliveryFee, Number(tax.rows[0].tax_rate_bps));
    const gst = indiaTotals.tax_paise;
    const total = indiaTotals.total_paise;
    if (!Number.isSafeInteger(total) || total <= 0 || total > 2000000000) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Order total is invalid." });
    }
    const inserted = await client.query(
      `INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_address,payment_method,payment_status,status,
        currency,subtotal_cents,delivery_fee_cents,vat_cents,tax_rate_bps,total_cents,idempotency_key,request_fingerprint)
       VALUES($1,$2,$3,$4,'razorpay','pending','pending_payment','INR',$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,order_number,status,payment_status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,d.shipping_address + ", India PIN: " + d.shipping_pincode,subtotal,deliveryFee,gst,Number(tax.rows[0].tax_rate_bps),total,idempotencyKey,fingerprint]
    );
    const order = inserted.rows[0];
    for (const [sku, quantity] of quantities) {
      const item = bySku.get(sku);
      await client.query(
        `INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id,item.variant_id,sku,item.product_name,item.size_label,item.color_name,item.price_cents,quantity,Number(item.price_cents)*quantity,item.unit_cost_cents ?? null]
      );
      await client.query("INSERT INTO order_reservations(order_id,variant_id,quantity,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')", [order.id,item.variant_id,quantity]);
    }

    const razorpayOrder = await createRazorpayOrder({
      amountPaise: total,
      receipt: "BF-" + String(order.order_number),
      notes: { order_number: String(order.order_number), bf_order_id: String(order.id) }
    });
    const checkout = checkoutPayload(order, razorpayOrder, d);
    await client.query(
      "INSERT INTO payment_attempts(order_id,provider,txnid,provider_payment_id,amount_cents,currency,status,checkout_params) VALUES($1,'razorpay',$2,$3,$4,'INR','pending',$5::jsonb)",
      [order.id, "rzp_" + randomBytes(12).toString("hex"), razorpayOrder.id, total, JSON.stringify(checkout.checkout)]
    );
    await client.query(
      "INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'storefront.razorpay_payment.initiated','order',$1)",
      [String(order.id)]
    );
    await client.query("COMMIT");
    return res.status(201).json({ data: checkout });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client?.release();
  }
});

async function finalizeCapturedPayment({ razorpayOrderId, payment, callbackPayload }) {
  if (!payment || payment.order_id !== razorpayOrderId || payment.status !== "captured" || payment.captured !== true) {
    return { ok: false, reason: "payment_not_captured" };
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT pa.*,o.id AS order_id,o.order_number,o.customer_email
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='razorpay' AND pa.provider_payment_id=$1 FOR UPDATE OF pa`,
      [razorpayOrderId]
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "payment_attempt_not_found" };
    }
    const attempt = found.rows[0];
    const order = await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [attempt.order_id]);
    if (attempt.status === "paid" || order.rows[0]?.payment_status === "paid") {
      await client.query("COMMIT");
      return { ok: true, duplicate: true, orderNumber: attempt.order_number };
    }
    if (Number(payment.amount) !== Number(attempt.amount_cents) || payment.currency !== "INR") {
      await client.query("UPDATE payment_attempts SET status='review',callback_payload=$1::jsonb WHERE id=$2", [JSON.stringify(callbackPayload),attempt.id]);
      await client.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1", [attempt.order_id]);
      await client.query("COMMIT");
      return { ok: false, reason: "payment_amount_mismatch" };
    }
    const reservations = await client.query(
      "SELECT variant_id,quantity,expires_at FROM order_reservations WHERE order_id=$1 ORDER BY variant_id FOR UPDATE",
      [attempt.order_id]
    );
    const itemCount = await client.query("SELECT count(DISTINCT variant_id)::int AS count FROM order_items WHERE order_id=$1", [attempt.order_id]);
    let stockReview = !reservations.rowCount || reservations.rowCount !== Number(itemCount.rows[0].count) ||
      reservations.rows.some(r => new Date(r.expires_at).getTime() <= Date.now());
    const locked = [];
    for (const reservation of reservations.rows) {
      if (stockReview) break;
      const inventory = await client.query(
        `SELECT stock_qty,COALESCE((SELECT sum(quantity) FROM order_reservations WHERE variant_id=$1 AND order_id<>$2 AND expires_at>now()),0)::int AS other_reserved
         FROM variants WHERE id=$1 FOR UPDATE`,
        [reservation.variant_id,attempt.order_id]
      );
      if (!inventory.rowCount || Number(inventory.rows[0].stock_qty) - Number(reservation.quantity) < Number(inventory.rows[0].other_reserved)) stockReview = true;
      else locked.push(reservation);
    }
    if (!stockReview) {
      for (const reservation of locked) {
        await client.query("UPDATE variants SET stock_qty=stock_qty-$1,updated_at=now() WHERE id=$2", [reservation.quantity,reservation.variant_id]);
        await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,reference_order_id) VALUES($1,$2,'storefront_razorpay_paid',$3)", [reservation.variant_id,-Number(reservation.quantity),attempt.order_id]);
        await allocateOrderWarehouseStock(client, { orderId: attempt.order_id, variantId: reservation.variant_id, quantity: Number(reservation.quantity), reason: "storefront_razorpay_paid" });
      }
    }
    await client.query("DELETE FROM order_reservations WHERE order_id=$1", [attempt.order_id]);
    await client.query(
      "UPDATE payment_attempts SET status=$1,callback_payload=$2::jsonb,verified_at=now() WHERE id=$3",
      [stockReview ? "paid_stock_review" : "paid",JSON.stringify(callbackPayload),attempt.id]
    );
    await client.query(
      "UPDATE orders SET payment_status=$1,status=$2,updated_at=now() WHERE id=$3",
      [stockReview ? "review" : "paid",stockReview ? "confirmed" : "processing",attempt.order_id]
    );
    await client.query(
      "INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,$1,'order',$2)",
      [stockReview ? "payment.paid.stock_review" : "payment.paid",String(attempt.order_id)]
    );
    await client.query("COMMIT");
    if (!stockReview) {
      try {
        await deliverEmail({ kind: "order_confirmation", recipient: attempt.customer_email,
          subject: "BF SHOES payment received for order #" + attempt.order_number,
          textBody: "Your BF SHOES payment has been verified. Order #" + attempt.order_number + " is now being processed." });
      } catch {}
    }
    return { ok: true, orderNumber: attempt.order_number, status: stockReview ? "review" : "success" };
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release();
  }
}

razorpayStorefrontRouter.post("/payments/razorpay/verify", async (req, res, next) => {
  const body = z.object({
    razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
    razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i)
  }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid Razorpay payment verification payload." });
  if (!razorpayConfigured()) return res.status(503).json({ error: "Razorpay verification is not enabled in this environment." });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body.data;
  if (!verifyRazorpayPaymentSignature({ orderId, paymentId, signature, secret: process.env.RAZORPAY_KEY_SECRET })) {
    return res.status(400).json({ error: "Razorpay payment signature is invalid." });
  }
  try {
    const attempt = await pool.query(
      "SELECT amount_cents FROM payment_attempts WHERE provider='razorpay' AND provider_payment_id=$1",
      [orderId]
    );
    if (!attempt.rowCount) return res.status(404).json({ error: "Razorpay order not found." });
    const payment = await fetchRazorpayPayment(paymentId);
    if (Number(payment.amount) !== Number(attempt.rows[0].amount_cents) || payment.currency !== "INR" || payment.order_id !== orderId) {
      return res.status(409).json({ error: "Razorpay payment details do not match this BF SHOES order." });
    }
    const result = await finalizeCapturedPayment({ razorpayOrderId: orderId, payment, callbackPayload: body.data });
    if (!result.ok) return res.status(409).json({ error: "Payment is not yet confirmed as captured.", reason: result.reason });
    return res.json({ data: { order_number: result.orderNumber, status: result.status || "success", already_processed: Boolean(result.duplicate) } });
  } catch (err) { return next(err); }
});

razorpayStorefrontRouter.post("/payments/razorpay/webhook", async (req, res, next) => {
  const rawBody = req.rawBody;
  const signature = req.get("x-razorpay-signature") || "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!rawBody || !webhookSecret) return res.status(503).json({ error: "Razorpay webhook secret is not configured." });
  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) return res.status(401).json({ error: "Invalid Razorpay webhook signature." });
  try {
    const event = req.body || {};
    if (event.event !== "payment.captured") return res.status(200).json({ status: "ignored" });
    const payment = event.payload?.payment?.entity;
    const orderId = String(payment?.order_id || "");
    if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return res.status(400).json({ error: "Invalid Razorpay order reference." });
    const result = await finalizeCapturedPayment({ razorpayOrderId: orderId, payment, callbackPayload: event });
    if (!result.ok && result.reason !== "payment_attempt_not_found") return res.status(409).json({ error: "Captured payment needs reconciliation.", reason: result.reason });
    return res.status(200).json({ status: result.ok ? "processed" : "unmatched" });
  } catch (err) { return next(err); }
});
