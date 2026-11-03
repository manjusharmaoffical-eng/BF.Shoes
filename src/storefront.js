import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { deliverEmail } from "./email.js";
import { randomBytes } from "node:crypto";
import { payuConfigured, publicBaseUrl, payuPaymentUrl, payuRequestHash, payuResponseHash, safeHashEqual, verifyPayuPayment } from "./payu.js";

export const storefrontRouter = express.Router();

function amountToCents(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

const checkoutSchema = z.object({
  customer_name: z.string().trim().min(2).max(160),
  customer_email: z.string().trim().email().max(254),
  customer_phone: z.string().trim().min(7).max(30).regex(/^[+()0-9 .-]+$/),
  shipping_address: z.string().trim().min(10).max(1000),
  shipping_country: z.enum(["IN", "AE"]).default("AE"),
  shipping_pincode: z.string().trim().optional().default(""),
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

storefrontRouter.get("/market-config", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM products WHERE active = true AND currency = 'INR') AS india_pricing_configured,
         EXISTS (SELECT 1 FROM products WHERE active = true AND currency = 'AED') AS uae_pricing_configured,
         EXISTS (SELECT 1 FROM tax_profiles WHERE active = true AND jurisdiction = 'IN_GST') AS india_tax_profile_configured,
         EXISTS (SELECT 1 FROM tax_profiles WHERE active = true AND jurisdiction = 'AE_VAT') AS uae_tax_profile_configured`
    );
    const row = result.rows[0];
    const feeConfigured = value => value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
    const indiaPricingVerified = process.env.INDIA_PRICING_VERIFIED === "true" && row.india_pricing_configured;
    const indiaFeeConfigured = process.env.INDIA_DELIVERY_FEE_VERIFIED === "true" && feeConfigured(process.env.INDIA_DELIVERY_FEE_PAISE);
    const indiaPayuConfigured = payuConfigured();
    const indiaCheckoutEnabled = indiaPricingVerified && indiaFeeConfigured && row.india_tax_profile_configured && indiaPayuConfigured;
    res.set("Cache-Control", "no-store");
    return res.json({ data: [
      { country: "IN", currency: "INR", pricingConfigured: indiaPricingVerified, deliveryFeeConfigured: indiaFeeConfigured, tax: "GST", taxProfileConfigured: row.india_tax_profile_configured, paymentProvider: "PayU", paymentConfigured: indiaPayuConfigured, checkoutEnabled: indiaCheckoutEnabled },
      { country: "AE", currency: "AED", pricingConfigured: row.uae_pricing_configured, deliveryFeeConfigured: feeConfigured(process.env.UAE_DELIVERY_FEE_FILS), tax: "VAT", taxProfileConfigured: row.uae_tax_profile_configured, paymentProvider: process.env.UAE_PAYMENT_PROVIDER || null, paymentConfigured: false, checkoutEnabled: false }
    ] });
  } catch (err) { next(err); }
});

storefrontRouter.get("/products", async (req, res, next) => {
  const market = String(req.query.market || "IN").toUpperCase();
  const currency = market === "IN" ? "INR" : market === "AE" ? "AED" : null;
  if (!currency) return res.status(400).json({ error: "market must be IN or AE" });
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.brand, p.price_cents, p.currency, p.image_url,
        COALESCE(json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_label', v.size_label,
          'color_name', v.color_name, 'stock_qty', v.stock_qty)
          ORDER BY v.size_label) FILTER (WHERE v.id IS NOT NULL AND v.active = true), '[]') AS variants
       FROM products p LEFT JOIN variants v ON v.product_id = p.id
       WHERE p.active = true AND p.currency = $1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,
      [currency]
    );
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ data: result.rows, market, currency });
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
      "SELECT order_number, customer_email, status, payment_status, currency, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at FROM orders WHERE order_number=$1 AND customer_email=$2",
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


storefrontRouter.post("/orders/payu", async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your checkout details", details: parsed.error.flatten() });
  const suppliedKey = req.get("idempotency-key");
  if (!suppliedKey || suppliedKey.length < 16 || suppliedKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(suppliedKey)) return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  const d = parsed.data;
  if (d.shipping_country !== "IN") return res.status(400).json({ error: "PayU India checkout is only configured for the India market." });
  if (d.shipping_pincode !== "500052") return res.status(400).json({ error: "BF SHOES currently delivers only to PIN code 500052." });
  const allowedPins = new Set((process.env.INDIA_DELIVERY_PINCODES || "500052").split(",").map(value => value.trim()).filter(Boolean));
  if (!allowedPins.has(d.shipping_pincode)) return res.status(400).json({ error: "Sorry, BF SHOES does not deliver to this PIN code yet." });
  if (process.env.INDIA_PRICING_VERIFIED !== "true") return res.status(503).json({ error: "India product pricing has not been verified by the owner. Checkout remains disabled." });
  if (process.env.INDIA_DELIVERY_FEE_VERIFIED !== "true") return res.status(503).json({ error: "India delivery fee has not been verified by the owner. Checkout remains disabled." });
  if (!payuConfigured()) return res.status(503).json({ error: "PayU merchant credentials and HTTPS callback URL are not configured yet." });
  const deliveryFeeCents = Number(process.env.INDIA_DELIVERY_FEE_PAISE);
  if (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0) return res.status(503).json({ error: "India delivery fee is not configured. Checkout remains disabled." });
  const baseUrl = publicBaseUrl();
  const idempotencyKey = "store:" + suppliedKey;
  const requestFingerprint = storefrontRequestFingerprint(d);
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
      if (order.request_fingerprint !== requestFingerprint) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This checkout key was already used for a different order." });
      }
      const attempt = await client.query("SELECT txnid,status,checkout_params FROM payment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1", [order.id]);
      await client.query("COMMIT");
      if (order.payment_status === "paid") return res.status(409).json({ error: "This order has already been paid.", order_number: order.order_number });
      if (attempt.rows[0]?.status === "pending") {
        const reservation = await pool.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE expires_at>now())::int AS active FROM order_reservations WHERE order_id=$1",[order.id]);
        if (reservation.rows[0].total > 0 && reservation.rows[0].active === reservation.rows[0].total) {
          return res.status(200).json({ data: { order_number: order.order_number, checkout: { action: payuPaymentUrl(), method: "POST", fields: attempt.rows[0].checkout_params }, idempotent_replay: true } });
        }
        await pool.query("UPDATE payment_attempts SET status='review' WHERE txnid=$1 AND status='pending'",[attempt.rows[0].txnid]);
        await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'",[order.id]);
        return res.status(409).json({ error: "The previous payment reservation expired. Start a new checkout session." });
      }
      return res.status(409).json({ error: "A previous payment attempt is no longer pending. Start a fresh checkout session." });
    }
    await client.query("DELETE FROM order_reservations WHERE expires_at<=now()");
    const tax = await client.query("SELECT EXISTS (SELECT 1 FROM tax_profiles WHERE active=true AND jurisdiction='IN_GST') AS configured");
    if (!tax.rows[0].configured) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "An active India GST tax profile is required before checkout." });
    }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,
        COALESCE((SELECT sum(r.quantity) FROM order_reservations r WHERE r.variant_id=v.id AND r.expires_at>now()),0)::int AS reserved_qty,
        v.active AS variant_active,p.name AS product_name,p.price_cents,p.unit_cost_cents,p.currency,p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.sku=ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`, [skus]
    );
    if (found.rowCount !== skus.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: "One or more selected sizes are no longer available" }); }
    const bySku = new Map(found.rows.map(row => [row.sku,row]));
    let subtotal = 0;
    for (const [sku,qty] of quantities) {
      const v=bySku.get(sku);
      if(!v.variant_active||!v.product_active){await client.query("ROLLBACK");return res.status(409).json({error:"A selected item is no longer available"});}
      const available=Number(v.stock_qty)-Number(v.reserved_qty);
      if(available<qty){await client.query("ROLLBACK");return res.status(409).json({error:"Not enough available stock for "+v.product_name+" (size "+v.size_label+").",available});}
      subtotal+=Number(v.price_cents)*qty;
      if(!Number.isSafeInteger(subtotal)||subtotal>2000000000){await client.query("ROLLBACK");return res.status(400).json({error:"Order total exceeds limit"});}
    }
    if(found.rows.some(v=>v.currency!=="INR")){await client.query("ROLLBACK");return res.status(503).json({error:"PayU India checkout requires INR product prices only."});}
    const totalCents=subtotal+deliveryFeeCents;
    if(!Number.isSafeInteger(totalCents)||totalCents<=0||totalCents>2000000000){await client.query("ROLLBACK");return res.status(400).json({error:"Order total is invalid."});}
    const inserted=await client.query(
      `INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_address,payment_method,payment_status,status,
        currency,subtotal_cents,delivery_fee_cents,total_cents,idempotency_key,request_fingerprint)
       VALUES($1,$2,$3,$4,'payu','pending','pending_payment','INR',$5,$6,$7,$8,$9)
       RETURNING id,order_number,status,payment_status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,d.shipping_address+", India PIN: "+d.shipping_pincode,subtotal,deliveryFeeCents,totalCents,idempotencyKey,requestFingerprint]
    );
    const order=inserted.rows[0];
    for(const [sku,qty] of quantities){
      const v=bySku.get(sku);
      await client.query(
        `INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id,v.variant_id,sku,v.product_name,v.size_label,v.color_name,v.price_cents,qty,Number(v.price_cents)*qty,v.unit_cost_cents??null]
      );
      await client.query("INSERT INTO order_reservations(order_id,variant_id,quantity,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')",[order.id,v.variant_id,qty]);
    }
    const txnid="BF"+randomBytes(10).toString("hex");
    const amount=(totalCents/100).toFixed(2);
    const fields={
      key:process.env.PAYU_MERCHANT_KEY,txnid,amount,productinfo:"BF SHOES order #"+order.order_number,
      firstname:d.customer_name.trim().split(/\s+/)[0].slice(0,60),
      email:d.customer_email.toLowerCase(),phone:d.customer_phone,
      surl:baseUrl+"/api/v1/store/payments/payu/callback",
      furl:baseUrl+"/api/v1/store/payments/payu/callback",
      udf1:String(order.order_number),udf2:String(order.id),udf3:"",udf4:"",udf5:""
    };
    fields.hash=payuRequestHash(fields,process.env.PAYU_MERCHANT_SALT);
    await client.query("INSERT INTO payment_attempts(order_id,provider,txnid,amount_cents,currency,status,checkout_params) VALUES($1,'payu',$2,$3,'INR','pending',$4::jsonb)",
      [order.id,txnid,totalCents,JSON.stringify(fields)]);
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'storefront.payment.initiated','order',$1)",[String(order.id)]);
    await client.query("COMMIT");
    res.status(201).json({data:{order_number:order.order_number,checkout:{action:payuPaymentUrl(),method:"POST",fields}}});
  }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});next(err);}
  finally{client?.release();}
});

storefrontRouter.post("/payments/payu/callback", express.urlencoded({extended:false,limit:"30kb"}), async(req,res,next)=>{
  const fields=req.body||{};
  const txnid=String(fields.txnid||"");
  const baseUrl=publicBaseUrl();
  try{
    if(!baseUrl||!txnid||String(fields.key||"")!==String(process.env.PAYU_MERCHANT_KEY||""))return res.status(400).send("Invalid payment callback.");
    const found=await pool.query(
      `SELECT pa.*,o.id AS order_id,o.order_number,o.customer_name,o.customer_email
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='payu' AND pa.txnid=$1`,[txnid]
    );
    if(!found.rowCount)return res.status(404).send("Payment attempt not found.");
    const attempt=found.rows[0];
    if(amountToCents(fields.amount)!==Number(attempt.amount_cents))return res.status(400).send("Payment amount mismatch.");
    const expectedHash=payuResponseHash(fields,process.env.PAYU_MERCHANT_SALT||"");
    if(!safeHashEqual(expectedHash,String(fields.hash||"")))return res.status(400).send("Payment response could not be verified.");
    if(fields.status==="success"){
      const verified=await verifyPayuPayment(txnid,Number(attempt.amount_cents));
      if(!verified.verified){
        await pool.query("UPDATE payment_attempts SET status='review',provider_payment_id=$1,callback_payload=$2::jsonb WHERE id=$3 AND status='pending'",
          [verified.providerPaymentId,JSON.stringify(fields),attempt.id]);
        await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'",[attempt.order_id]);
        return res.redirect(303,baseUrl+"/payment-result.html?status=review&order="+encodeURIComponent(attempt.order_number));
      }
      let client;let stockReview=false;
      try{
        client=await pool.connect();await client.query("BEGIN");
        const locked=await client.query("SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE",[attempt.id]);
        const order=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[attempt.order_id]);
        if(["paid","paid_stock_review"].includes(locked.rows[0]?.status)||["paid","review"].includes(order.rows[0]?.payment_status)){
          await client.query("COMMIT");
          const resultStatus = locked.rows[0]?.status === "paid_stock_review" || order.rows[0]?.payment_status === "review" ? "review" : "success";
          return res.redirect(303,baseUrl+"/payment-result.html?status="+resultStatus+"&order="+encodeURIComponent(attempt.order_number));
        }
        const reservations=await client.query("SELECT variant_id,quantity FROM order_reservations WHERE order_id=$1 ORDER BY variant_id FOR UPDATE",[attempt.order_id]);
        const itemCount=await client.query("SELECT count(DISTINCT variant_id)::int AS count FROM order_items WHERE order_id=$1",[attempt.order_id]);
        const lockedReservations=[];
        if(locked.rows[0]?.status==="failed"||order.rows[0]?.payment_status==="failed"||reservations.rowCount!==Number(itemCount.rows[0].count))stockReview=true;
        for(const reservation of reservations.rows){
          if(stockReview)break;
          const v=await client.query(
            `SELECT stock_qty,COALESCE((SELECT sum(quantity) FROM order_reservations WHERE variant_id=$1 AND order_id<>$2 AND expires_at>now()),0)::int AS other_reserved
             FROM variants WHERE id=$1 FOR UPDATE`,[reservation.variant_id,attempt.order_id]);
          if(!v.rowCount||Number(v.rows[0].stock_qty)-Number(reservation.quantity)<Number(v.rows[0].other_reserved)){stockReview=true;break;}
          lockedReservations.push(reservation);
        }
        if(!stockReview){
          for(const reservation of lockedReservations){
            await client.query("UPDATE variants SET stock_qty=stock_qty-$1,updated_at=now() WHERE id=$2",[reservation.quantity,reservation.variant_id]);
            await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,reference_order_id) VALUES($1,$2,'storefront_payu_paid',$3)",
              [reservation.variant_id,-Number(reservation.quantity),attempt.order_id]);
            let unassignedQty=Number(reservation.quantity);
            const locations=await client.query("SELECT warehouse_id,quantity FROM warehouse_inventory WHERE variant_id=$1 AND quantity>0 ORDER BY updated_at,warehouse_id FOR UPDATE",[reservation.variant_id]);
            for(const location of locations.rows){
              if(unassignedQty<=0)break;
              const taken=Math.min(unassignedQty,Number(location.quantity));
              await client.query("UPDATE warehouse_inventory SET quantity=quantity-$1,updated_at=now() WHERE warehouse_id=$2 AND variant_id=$3",[taken,location.warehouse_id,reservation.variant_id]);
              await client.query("INSERT INTO warehouse_stock_movements(warehouse_id,variant_id,delta,reason,reference_type,reference_id) VALUES($1,$2,$3,'storefront_payu_paid','order',$4)",
                [location.warehouse_id,reservation.variant_id,-taken,attempt.order_id]);
              unassignedQty-=taken;
            }
          }
        }
        await client.query("DELETE FROM order_reservations WHERE order_id=$1",[attempt.order_id]);
        await client.query("UPDATE payment_attempts SET status=$1,provider_payment_id=$2,callback_payload=$3::jsonb,verified_at=now() WHERE id=$4",
          [stockReview?"paid_stock_review":"paid",verified.providerPaymentId,JSON.stringify(fields),attempt.id]);
        await client.query("UPDATE orders SET payment_status=$1,status=$2,updated_at=now() WHERE id=$3",
          [stockReview?"review":"paid",stockReview?"confirmed":"processing",attempt.order_id]);
        await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,$1,'order',$2)",
          [stockReview?"payment.paid.stock_review":"payment.paid",String(attempt.order_id)]);
        await client.query("COMMIT");
      }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});throw err;}
      finally{client?.release();}
      if(!stockReview){try{await deliverEmail({kind:"order_confirmation",recipient:attempt.customer_email,subject:"BF SHOES payment received for order #"+attempt.order_number,textBody:"Your BF SHOES payment has been verified. Order #"+attempt.order_number+" is now being processed."});}catch{}}
      return res.redirect(303,baseUrl+"/payment-result.html?status="+(stockReview?"review":"success")+"&order="+encodeURIComponent(attempt.order_number));
    }
    if(fields.status==="failure"){
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        await client.query("UPDATE payment_attempts SET status='failed',callback_payload=$1::jsonb WHERE txnid=$2 AND status='pending'",[JSON.stringify(fields),txnid]);
        await client.query("UPDATE orders SET payment_status='failed',status='cancelled',updated_at=now() WHERE id=$1 AND payment_status='pending'",[attempt.order_id]);
        await client.query("DELETE FROM order_reservations WHERE order_id=$1",[attempt.order_id]);
        await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'payment.failed','order',$1)",[String(attempt.order_id)]);
        await client.query("COMMIT");
      }catch(err){await client.query("ROLLBACK").catch(()=>{});throw err;}finally{client.release();}
      return res.redirect(303,baseUrl+"/payment-result.html?status=failed&order="+encodeURIComponent(attempt.order_number));
    }
    return res.redirect(303,baseUrl+"/payment-result.html?status=pending&order="+encodeURIComponent(attempt.order_number));
  }catch(err){next(err);}
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
    if (d.shipping_pincode !== "500052") return res.status(400).json({ error: "BF SHOES currently delivers only to PIN code 500052." });
    const pin = d.shipping_pincode;
    if (!/^[1-9][0-9]{5}$/.test(pin)) return res.status(400).json({ error: "Enter a valid six-digit Indian PIN code" });
    const allowedPins = new Set((process.env.INDIA_DELIVERY_PINCODES || "500052").split(",").map(value => value.trim()).filter(Boolean));
    if (!allowedPins.size) return res.status(503).json({ error: "India delivery is not configured yet. Please contact the store before ordering." });
    if (!allowedPins.has(pin)) return res.status(400).json({ error: "Sorry, BF SHOES does not deliver to this PIN code yet." });
    // Safety gate: India checkout stays disabled until verified market pricing, delivery, tax, and payment configuration is complete.
    return res.status(503).json({ error: "India delivery to this PIN code is planned, but checkout is not enabled yet. INR product pricing and delivery fee must be configured first." });
  } else {
    return res.status(503).json({ error: "UAE checkout is not enabled yet. Verified AED pricing, delivery fee, VAT profile, and payment gateway setup are required first." });
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
    if (currency !== "INR") { await client.query("ROLLBACK"); return res.status(503).json({ error: "India checkout requires verified INR product prices." }); }
    const deliveryFeeCents = Number(process.env.INDIA_DELIVERY_FEE_PAISE);
    if (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "India delivery fee is not configured. Checkout remains disabled." });
    }

    const inserted = await client.query(
      `INSERT INTO orders(customer_name, customer_email, customer_phone, shipping_address, payment_method,
         currency, subtotal_cents, delivery_fee_cents, total_cents, idempotency_key, request_fingerprint)
       VALUES($1,$2,$3,$4,'cod',$5,$6,$7,$6+$7,$8,$9) RETURNING order_number, status, subtotal_cents, delivery_fee_cents, total_cents, currency, created_at`,
      [d.customer_name, d.customer_email.toLowerCase(), d.customer_phone, `${d.shipping_address}${d.shipping_country === "IN" ? `, India PIN: ${d.shipping_pincode}` : ""}`, currency, subtotal, deliveryFeeCents, idempotencyKey, requestFingerprint]
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
Total: ${order.currency} ${(Number(order.subtotal_cents) / 100).toFixed(2)}\
Payment: Cash on Delivery\
\
We will update you as your order progresses.` });
    } catch { /* order is committed; notification delivery is non-blocking */ }
    res.status(201).json({ data: order });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client?.release(); }
});
