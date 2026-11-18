import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { aggregateStorefrontItems, storefrontRequestFingerprint } from "./storefront-policies.js";
import { deliverEmail } from "./email.js";
import { parseIndiaMarketEnv, calculateIndiaTotals, resolveIndiaGstStatus } from "./india-market-policy.js";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { payuConfigured, publicBaseUrl, payuPaymentUrl, payuRequestHash, payuResponseHash, safeHashEqual, verifyPayuPayment } from "./payu.js";
import { paytabsConfigured, createPaytabsPayment, paytabsSignatureValid, verifyPaytabsPayment } from "./paytabs.js";
import { allocateOrderWarehouseStock } from "./warehouse-stock.js";
import { calculateUaeTotals } from "./uae-market-policy.js";
import { binancePayConfigured, createBinancePayOrder, getBinancePayCertificate, queryBinancePayOrder, verifyBinanceWebhookSignature } from "./binance-pay.js";
import { codRouter, getCodMarketReadiness } from "./cod.js";


export const storefrontRouter = express.Router();
storefrontRouter.use(codRouter);

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
  shipping_country: z.enum(["IN", "AE"]).default("IN"),
  shipping_pincode: z.string().trim().optional().default(""),
  payment_method: z.enum(["payu", "payu_qr", "paytabs", "cod"]),
  shipping_emirate: z.string().trim().optional().default(""),
  items: z.array(z.object({ sku: z.string().trim().min(2).max(80), quantity: z.number().int().min(1).max(10) })).min(1).max(20)
}).strict();
const binanceCheckoutSchema = checkoutSchema.extend({ payment_method: z.literal("binance").default("binance") });

storefrontRouter.get("/website-qr.png", async (_req, res, next) => {
  try {
    const baseUrl = publicBaseUrl() || "https://bfshoes.online";
    const qr = await QRCode.toBuffer(new URL("/", baseUrl).toString(), {
      type: "png",
      width: 360,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#050608", light: "#ffffff" }
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    return res.send(qr);
  } catch (err) { return next(err); }
});

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
         (SELECT count(*) = 1 AND COALESCE(bool_and(currency = 'INR' AND trim(registration_number) <> '' AND trim(seller_state) <> '' AND tax_rate_bps BETWEEN 1 AND 10000), false) FROM tax_profiles WHERE active = true AND jurisdiction = 'IN_GST') AS india_tax_profile_configured,
         EXISTS (SELECT 1 FROM tax_profiles WHERE active = true AND jurisdiction = 'AE_VAT') AS uae_tax_profile_configured`
    );
    const row = result.rows[0];
    const codReadiness = await getCodMarketReadiness();
    const feeConfigured = value => value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
    const indiaPricingVerified = process.env.INDIA_PRICING_VERIFIED === "true" && row.india_pricing_configured;
    const indiaFeeConfigured = process.env.INDIA_DELIVERY_FEE_VERIFIED === "true" && feeConfigured(process.env.INDIA_DELIVERY_FEE_PAISE);
    const indiaPaymentMethods = String(process.env.INDIA_PAYMENT_METHODS || "").split(",").map(value => value.trim().toLowerCase());
    const indiaPayuConfigured = process.env.INDIA_PAYMENT_GATEWAY === "payu" && indiaPaymentMethods.includes("payu") && payuConfigured();
    // Credentials alone never activate checkout; owner verification, prices, delivery,
    // GST profile and the server-side PayU callback/Verify Payment flow are all required.
    const indiaCheckoutEnabled = process.env.INDIA_CHECKOUT_VERIFIED === "true" && indiaPricingVerified && indiaFeeConfigured && row.india_tax_profile_configured && indiaPayuConfigured;
    const uaeFeeConfigured = feeConfigured(process.env.UAE_DELIVERY_FEE_FILS);
    const uaePaytabsConfigured = process.env.UAE_PAYMENT_PROVIDER === "paytabs" && paytabsConfigured();
    const uaePricingVerified = process.env.UAE_PRICING_VERIFIED === "true" && row.uae_pricing_configured;
    const uaeFeeVerified = process.env.UAE_DELIVERY_FEE_VERIFIED === "true" && uaeFeeConfigured;
    const uaeCheckoutEnabled = process.env.UAE_CHECKOUT_VERIFIED === "true" && uaePricingVerified && uaeFeeVerified && row.uae_tax_profile_configured && uaePaytabsConfigured;
    res.set("Cache-Control", "no-store");
    return res.json({ data: [
      { country: "IN", currency: "INR", pricingConfigured: indiaPricingVerified, deliveryFeeConfigured: indiaFeeConfigured, tax: "GST", taxProfileConfigured: row.india_tax_profile_configured, paymentProvider: "PayU", paymentConfigured: indiaPayuConfigured, paymentQrEnabled: indiaPayuConfigured, checkoutEnabled: indiaCheckoutEnabled, codEnabled: codReadiness.IN.enabled },
      { country: "AE", currency: "AED", pricingConfigured: uaePricingVerified, deliveryFeeConfigured: uaeFeeVerified, tax: "VAT", taxProfileConfigured: row.uae_tax_profile_configured, paymentProvider: "PayTabs", paymentConfigured: uaePaytabsConfigured, checkoutEnabled: uaeCheckoutEnabled, codEnabled: codReadiness.AE.enabled }
    ] });
  } catch (err) { next(err); }
});

// Public, read-only product gallery endpoint. The owner-only AI Studio API must never be used by shoppers.
storefrontRouter.get("/products/:id/images", async (req, res, next) => {
  const productId = z.string().uuid().safeParse(req.params.id);
  if (!productId.success) return res.status(404).json({ data: [] });
  try {
    const result = await pool.query(
      `SELECT pi.image_url, pi.alt_text
       FROM product_images pi
       JOIN products p ON p.id = pi.product_id
       WHERE pi.product_id = $1 AND p.active = true
       ORDER BY pi.sort_order, pi.created_at, pi.id`,
      [productId.data]
    );
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json({ data: result.rows });
  } catch (err) {
    // Older environments may not have the optional gallery migration yet.
    if (err.code === "42P01" && /product_images/i.test(err.message || "")) {
      try {
        const fallback = await pool.query("SELECT image_url, name AS alt_text FROM products WHERE id=$1 AND active=true", [productId.data]);
        res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        return res.json({ data: fallback.rows.filter(row => row.image_url) });
      } catch (fallbackError) { return next(fallbackError); }
    }
    return next(err);
  }
});

storefrontRouter.get("/products", async (req, res, next) => {
  const market = String(req.query.market || "IN").toUpperCase();
  const currency = market === "IN" ? "INR" : market === "AE" ? "AED" : null;
  if (!currency) return res.status(400).json({ error: "market must be IN or AE" });
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.short_description, p.brand,
        COALESCE(to_jsonb(p)->>'category','shoes') AS category,
        COALESCE(to_jsonb(p)->>'audience','unisex') AS audience,
        COALESCE(to_jsonb(p)->>'product_type','general') AS product_type,
        COALESCE(to_jsonb(p)->'attributes','{}'::jsonb) AS attributes,
        p.price_cents, p.currency, p.image_url, p.created_at,
        NULLIF(COALESCE(to_jsonb(p)->>'mrp_cents', to_jsonb(p)->>'compare_at_price_cents', to_jsonb(p)->>'original_price_cents'), '')::integer AS mrp_cents,
        (p.currency <> $1) AS price_pending_conversion,
        COALESCE(bool_and(v.stock_verified) FILTER (WHERE v.id IS NOT NULL AND v.active = true), false) AS stock_verified,
        COALESCE(json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_label', v.size_label,
          'color_name', v.color_name, 'stock_qty', CASE WHEN v.stock_verified THEN v.stock_qty ELSE 0 END,
          'stock_verified', v.stock_verified)
          ORDER BY v.size_label) FILTER (WHERE v.id IS NOT NULL AND v.active = true), '[]') AS variants
       FROM products p LEFT JOIN variants v ON v.product_id = p.id
       WHERE p.active = true AND p.currency = $1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,
      [currency]
    );
    const pricingVerified = currency === "INR"
      ? process.env.INDIA_PRICING_VERIFIED === "true"
      : process.env.UAE_PRICING_VERIFIED === "true";
    const products = result.rows.map(product => ({
      ...product,
      price_verified: pricingVerified && !product.price_pending_conversion,
      price_pending_conversion: !pricingVerified || product.price_pending_conversion
    }));
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ data: products, market, currency });
  } catch (err) { next(err); }
});


async function getIndiaMarketConfig(db = pool) {
  const env = parseIndiaMarketEnv(process.env);
  const reasons = [];
  if (env.deliveryFeePaise === null || !Number.isSafeInteger(env.deliveryFeePaise) || env.deliveryFeePaise < 0 || env.deliveryFeePaise > 2000000000) reasons.push("delivery_fee_not_configured");
  if (!env.deliveryPincodes.includes("500052")) reasons.push("pin_500052_not_configured");
  const currencies = await db.query("SELECT currency, count(*)::int AS product_count FROM products WHERE active=TRUE GROUP BY currency");
  // INR and AED are separate market catalogs; AED products never trigger an India conversion.
  // India and UAE catalogs are intentionally separate. AED products must not block
  // India checkout; the order route independently rejects any non-INR SKU.
  if (!currencies.rows.some(row => row.currency === "INR" && Number(row.product_count) > 0)) reasons.push("no_inr_priced_products");
  if (!env.paymentMethods.length) reasons.push("payment_method_not_confirmed");
  let taxProfile = null, taxRate = 0;
  if (env.gstStatus === "registered") {
    const r = await db.query("SELECT id, currency, tax_rate_bps, registration_number, seller_state FROM tax_profiles WHERE jurisdiction='IN_GST' AND active=TRUE ORDER BY created_at DESC LIMIT 2");
    if (r.rowCount !== 1 || r.rows[0].currency !== "INR" || !String(r.rows[0].registration_number || "").trim() || !String(r.rows[0].seller_state || "").trim() || !Number.isSafeInteger(Number(r.rows[0].tax_rate_bps)) || Number(r.rows[0].tax_rate_bps) <= 0 || Number(r.rows[0].tax_rate_bps) > 10000) reasons.push("valid_in_gst_profile_required");
    else { taxProfile = r.rows[0]; taxRate = Number(r.rows[0].tax_rate_bps); }
  }
  const gstStatus = resolveIndiaGstStatus(env.gstStatus, taxProfile);
  if (gstStatus === "unconfigured") reasons.push("gst_status_not_confirmed");
  const onlineReady = env.paymentGateway === "payu" && env.paymentMethods.includes("payu") && payuConfigured();
  if (!onlineReady) reasons.push("payu_credentials_not_configured");
  if (process.env.INDIA_CHECKOUT_VERIFIED !== "true") reasons.push("india_checkout_not_owner_verified");
  return { currency: "INR", country: "IN", delivery_pincodes: env.deliveryPincodes, target_pincode: "500052", delivery_fee_paise: env.deliveryFeePaise, payment_methods: env.paymentMethods, payment_gateway: env.paymentGateway, online_payment_ready: onlineReady, online_payment_note: onlineReady ? "PayU credentials are configured; checkout remains closed until owner, GST, price and delivery verification plus end-to-end payment testing are complete." : "PayU merchant key, salt, enablement and HTTPS callback URL are required before online payments can be accepted.", gst_status: gstStatus, gst_rate_bps: gstStatus === "registered" ? taxRate : (gstStatus === "not_registered" ? 0 : null), checkout_ready: reasons.length === 0, setup_required: [...new Set(reasons)], tax_profile: taxProfile };
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
      "SELECT order_number, customer_email, status, payment_status, currency, subtotal_cents, delivery_fee_cents, vat_cents, tax_rate_bps, total_cents, shipping_country, shipping_emirate, created_at, updated_at FROM orders WHERE order_number=$1 AND customer_email=$2",
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
  const indiaPaymentConfig = parseIndiaMarketEnv(process.env);
  if (!["payu", "payu_qr"].includes(d.payment_method) || indiaPaymentConfig.paymentGateway !== "payu" || !indiaPaymentConfig.paymentMethods.includes("payu")) return res.status(503).json({ error: "India online checkout is configured for PayU only. Select PayU and verify the merchant configuration." });
  if (process.env.INDIA_CHECKOUT_VERIFIED !== "true") return res.status(503).json({ error: "India checkout remains disabled until the owner verifies the PayU, tax, price and delivery setup." });
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
          if (order.payment_method === "payu_qr" && attempt.rows[0].checkout_params?.qr_token) {
            const token = attempt.rows[0].checkout_params.qr_token;
            const expiresAt = attempt.rows[0].checkout_params.qr_expires_at;
            if (!expiresAt || Date.parse(expiresAt) <= Date.now()) return res.status(409).json({ error: "This payment QR has expired. Start a fresh checkout session." });
            const qrUrl = new URL("/pay.html", baseUrl);
            qrUrl.hash = "token=" + encodeURIComponent(token);
            const qrDataUrl = await QRCode.toDataURL(qrUrl.toString(), { width: 320, margin: 2, errorCorrectionLevel: "H", color: { dark: "#050608", light: "#ffffff" } });
            return res.status(200).json({ data: { order_number: order.order_number, checkout: { type: "qr", qr_data_url: qrDataUrl, token, expires_at: expiresAt }, idempotent_replay: true } });
          }
          return res.status(200).json({ data: { order_number: order.order_number, checkout: { action: payuPaymentUrl(), method: "POST", fields: attempt.rows[0].checkout_params }, idempotent_replay: true } });
        }
        await pool.query("UPDATE payment_attempts SET status='review' WHERE txnid=$1 AND status='pending'",[attempt.rows[0].txnid]);
        await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'",[order.id]);
        return res.status(409).json({ error: "The previous payment reservation expired. Start a new checkout session." });
      }
      return res.status(409).json({ error: "A previous payment attempt is no longer pending. Start a fresh checkout session." });
    }
    await client.query("DELETE FROM order_reservations WHERE expires_at<=now()");
    const tax = await client.query("SELECT count(*) = 1 AND COALESCE(bool_and(currency='INR' AND trim(registration_number)<>'' AND trim(seller_state)<>'' AND tax_rate_bps BETWEEN 1 AND 10000),false) AS configured FROM tax_profiles WHERE active=true AND jurisdiction='IN_GST'");
    if (!tax.rows[0].configured) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "An active India GST tax profile is required before checkout." });
    }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,v.stock_verified,
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
      if(!v.stock_verified){await client.query("ROLLBACK");return res.status(409).json({error:"Stock for "+v.product_name+" size "+v.size_label+" has not been physically verified yet."});}
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
       VALUES($1,$2,$3,$4,$5,'pending','pending_payment','INR',$6,$7,$8,$9,$10)
       RETURNING id,order_number,status,payment_status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,d.shipping_address+", India PIN: "+d.shipping_pincode,d.payment_method,subtotal,deliveryFeeCents,totalCents,idempotencyKey,requestFingerprint]
    );
    const order=inserted.rows[0];
    for(const [sku,qty] of quantities){
      const v=bySku.get(sku);
      await client.query(
        `INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id,v.variant_id,sku,v.product_name,v.size_label,v.color_name,v.price_cents,qty,Number(v.price_cents)*qty,v.unit_cost_cents ?? null]
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
    let checkoutParams = fields, qrToken = null, qrExpiresAt = null, qrDataUrl = null;
    if (d.payment_method === "payu_qr") {
      qrToken = randomBytes(24).toString("hex");
      const reservationExpiry = await client.query("SELECT min(expires_at) AS expires_at FROM order_reservations WHERE order_id=$1", [order.id]);
      qrExpiresAt = new Date(reservationExpiry.rows[0]?.expires_at || Date.now()).toISOString();
      checkoutParams = { ...fields, qr_token: qrToken, qr_expires_at: qrExpiresAt };
      const qrUrl = new URL("/pay.html", baseUrl);
      qrUrl.hash = "token=" + encodeURIComponent(qrToken);
      qrDataUrl = await QRCode.toDataURL(qrUrl.toString(), { width: 320, margin: 2, errorCorrectionLevel: "H", color: { dark: "#050608", light: "#ffffff" } });
    }
    await client.query("INSERT INTO payment_attempts(order_id,provider,txnid,amount_cents,currency,status,checkout_params) VALUES($1,'payu',$2,$3,'INR','pending',$4::jsonb)",
      [order.id,txnid,totalCents,JSON.stringify(checkoutParams)]);
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'storefront.payment.initiated','order',$1)",[String(order.id)]);
    await client.query("COMMIT");
    if (qrToken) return res.status(201).json({data:{order_number:order.order_number,checkout:{type:"qr",qr_data_url:qrDataUrl,token:qrToken,expires_at:qrExpiresAt}}});
    return res.status(201).json({data:{order_number:order.order_number,checkout:{action:payuPaymentUrl(),method:"POST",fields}}});
  }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});next(err);}
  finally{client?.release();}
});

async function expirePayuQrAttempt(token) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT pa.id,pa.status,o.id AS order_id,o.payment_status
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='payu' AND pa.checkout_params->>'qr_token'=$1
       FOR UPDATE OF pa,o`,
      [token]
    );
    const row = locked.rows[0];
    if (row?.status === "pending" && row.payment_status === "pending") {
      await client.query("UPDATE payment_attempts SET status='failed',callback_payload=jsonb_build_object('reason','qr_expired') WHERE id=$1 AND status='pending'", [row.id]);
      await client.query("UPDATE orders SET payment_status='failed',status='cancelled',updated_at=now() WHERE id=$1 AND payment_status='pending'", [row.order_id]);
      await client.query("DELETE FROM order_reservations WHERE order_id=$1", [row.order_id]);
      await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'payment.qr.expired','order',$1)", [String(row.order_id)]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { client.release(); }
}

storefrontRouter.get("/payments/payu/qr", async (req, res, next) => {
  const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[a-f0-9]{48}$/i.test(token)) return res.status(404).json({ error: "Payment link not found." });
  try {
    const found = await pool.query(
      `SELECT pa.checkout_params,pa.status,o.id AS order_id,o.payment_status
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='payu' AND pa.checkout_params->>'qr_token'=$1 LIMIT 1`,
      [token]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Payment link not found." });
    const attempt = found.rows[0];
    if (attempt.status !== "pending" || attempt.payment_status !== "pending") return res.status(410).json({ error: "This payment link is no longer active." });
    if (!attempt.checkout_params.qr_expires_at || Date.parse(attempt.checkout_params.qr_expires_at) <= Date.now()) { await expirePayuQrAttempt(token); return res.status(410).json({ error: "This payment link has expired." }); }
    const reservation = await pool.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE expires_at>now())::int AS active FROM order_reservations WHERE order_id=$1", [attempt.order_id]);
    if (!reservation.rows[0]?.total || reservation.rows[0].total !== reservation.rows[0].active) { await expirePayuQrAttempt(token); return res.status(410).json({ error: "The stock reservation for this payment link has expired." }); }
    const { qr_token, qr_expires_at, ...fields } = attempt.checkout_params;
    res.set("Cache-Control", "no-store");
    return res.json({ data: { action: payuPaymentUrl(), method: "POST", fields } });
  } catch (err) { return next(err); }
});

storefrontRouter.get("/payments/payu/qr-status", async (req, res, next) => {
  const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[a-f0-9]{48}$/i.test(token)) return res.status(404).json({ error: "Payment status not found." });
  try {
    const found = await pool.query(
      `SELECT pa.status,pa.checkout_params,pa.callback_payload,o.id AS order_id,o.payment_status,o.order_number
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='payu' AND pa.checkout_params->>'qr_token'=$1 LIMIT 1`,
      [token]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Payment status not found." });
    const row = found.rows[0];
    let status = row.status === "paid_stock_review" || row.payment_status === "review" ? "review" : row.status;
    const qrExpired = !row.checkout_params.qr_expires_at || Date.parse(row.checkout_params.qr_expires_at) <= Date.now();
    if (status === "pending" && qrExpired) { await expirePayuQrAttempt(token); status = "expired"; }
    if (status === "pending") {
      const reservation = await pool.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE expires_at>now())::int AS active FROM order_reservations WHERE order_id=$1", [row.order_id]);
      if (!reservation.rows[0]?.total || reservation.rows[0].total !== reservation.rows[0].active) { await expirePayuQrAttempt(token); status = "expired"; }
    }
    if (status === "failed" && row.callback_payload?.reason === "qr_expired") status = "expired";
    res.set("Cache-Control", "no-store");
    return res.json({ data: { status, order_number: row.order_number } });
  } catch (err) { return next(err); }
});

async function handlePayuCallback(req,res,next,{webhook=false}={}){
  const fields=req.body||{};
  const txnid=String(fields.txnid||"");
  const baseUrl=publicBaseUrl();
  const respond=(status,orderNumber)=>webhook?res.status(200).json({received:true,status,order_number:orderNumber}):res.redirect(303,baseUrl+"/payment-result.html?status="+status+"&order="+encodeURIComponent(orderNumber));
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
        return respond("review",attempt.order_number);
      }
      let client;let stockReview=false;
      try{
        client=await pool.connect();await client.query("BEGIN");
        const locked=await client.query("SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE",[attempt.id]);
        const order=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[attempt.order_id]);
        if(["paid","paid_stock_review"].includes(locked.rows[0]?.status)||["paid","review"].includes(order.rows[0]?.payment_status)){
          await client.query("COMMIT");
          const resultStatus = locked.rows[0]?.status === "paid_stock_review" || order.rows[0]?.payment_status === "review" ? "review" : "success";
          return respond(resultStatus,attempt.order_number);
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
            await allocateOrderWarehouseStock(client, { orderId: attempt.order_id, variantId: reservation.variant_id, quantity: Number(reservation.quantity), reason: "storefront_payu_paid" });
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
      return respond(stockReview?"review":"success",attempt.order_number);
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
      return respond("failed",attempt.order_number);
    }
    return respond("pending",attempt.order_number);
  }catch(err){next(err);}
}

const payuCallbackParser = express.urlencoded({extended:false,limit:"30kb"});
storefrontRouter.post("/payments/payu/callback", payuCallbackParser, (req,res,next)=>handlePayuCallback(req,res,next));
storefrontRouter.post("/payments/payu/webhook", payuCallbackParser, (req,res,next)=>handlePayuCallback(req,res,next,{webhook:true}));




// UAE Binance Pay hosted checkout. UAE pricing, delivery fee and active VAT
// profile must be verified before any payable order can be created.
storefrontRouter.post("/orders/binance", async (req, res, next) => {
  const parsed = binanceCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your checkout details", details: parsed.error.flatten() });
  const suppliedKey = req.get("idempotency-key");
  if (!suppliedKey || suppliedKey.length < 16 || suppliedKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(suppliedKey)) return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  const d = parsed.data;
  if (process.env.UAE_PAYMENT_PROVIDER !== "binance") return res.status(503).json({ error: "PayTabs is selected and checkout remains disabled until its merchant setup is verified." });
  if (d.shipping_country !== "AE") return res.status(400).json({ error: "Binance Pay checkout is currently for UAE orders only." });
  if (process.env.UAE_PRICING_VERIFIED !== "true") return res.status(503).json({ error: "UAE product pricing has not been owner-verified." });
  if (process.env.UAE_DELIVERY_FEE_VERIFIED !== "true") return res.status(503).json({ error: "UAE delivery fee has not been owner-verified." });
  if (!binancePayConfigured()) return res.status(503).json({ error: "Binance Pay is not enabled for this verified merchant environment yet." });
  const deliveryFeeCents = Number(process.env.UAE_DELIVERY_FEE_FILS);
  if (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0) return res.status(503).json({ error: "UAE delivery fee is not configured." });
  const baseUrl = publicBaseUrl();
  const idempotencyKey = "store:" + suppliedKey;
  const fingerprint = storefrontRequestFingerprint({ ...d, shipping_country: "AE" });
  const quantities = aggregateStorefrontItems(d.items);
  if ([...quantities.values()].some(q => q > 10)) return res.status(400).json({ error: "Maximum quantity per size is 10" });
  let client, order;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-order-idempotency'))", [idempotencyKey]);
    const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (existing.rowCount) {
      const prior = existing.rows[0];
      await client.query("COMMIT");
      if (prior.request_fingerprint !== fingerprint) return res.status(409).json({ error: "This checkout key was already used for a different order." });
      const attempt = await pool.query("SELECT checkout_params,status FROM payment_attempts WHERE order_id=$1 AND provider='binance' ORDER BY created_at DESC LIMIT 1", [prior.id]);
      if (prior.payment_status === "paid") return res.status(409).json({ error: "This order has already been paid.", order_number: prior.order_number });
      if (attempt.rows[0]?.status === "pending" && attempt.rows[0]?.checkout_params?.checkout_url) {
        return res.status(200).json({ data: { order_number: prior.order_number, checkout: { redirect_url: attempt.rows[0].checkout_params.checkout_url } }, idempotent_replay: true });
      }
      return res.status(409).json({ error: "The previous payment attempt is no longer available. Start a fresh checkout." });
    }
    const tax = await client.query("SELECT id,currency,tax_rate_bps FROM tax_profiles WHERE active=true AND jurisdiction='AE_VAT' ORDER BY created_at DESC LIMIT 2");
    if (tax.rowCount !== 1 || tax.rows[0].currency !== "AED" || !Number.isSafeInteger(Number(tax.rows[0].tax_rate_bps)) || Number(tax.rows[0].tax_rate_bps) <= 0 || Number(tax.rows[0].tax_rate_bps) > 10000) {
      await client.query("ROLLBACK");
      return res.status(503).json({ error: "A single valid active UAE VAT profile in AED is required before checkout." });
    }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,v.stock_verified,
       COALESCE((SELECT sum(r.quantity) FROM order_reservations r WHERE r.variant_id=v.id AND r.expires_at>now()),0)::int AS reserved_qty,
       v.active AS variant_active,p.name AS product_name,p.price_cents,p.unit_cost_cents,p.currency,p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`, [skus]);
    if (found.rowCount !== skus.length || found.rows.some(v => !v.variant_active || !v.product_active || v.currency !== "AED")) {
      await client.query("ROLLBACK"); return res.status(409).json({ error: "Selected UAE products or sizes are unavailable or not priced in AED." });
    }
    let subtotal = 0;
    for (const [sku, qty] of quantities) {
      const v = found.rows.find(row => row.sku === sku);
      if (!v.stock_verified) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Stock for " + v.product_name + " size " + v.size_label + " has not been physically verified yet." }); }
      if (Number(v.stock_qty) - Number(v.reserved_qty) < qty) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Insufficient available stock for " + v.product_name + " size " + v.size_label }); }
      subtotal += Number(v.price_cents) * qty;
      if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order total exceeds limit" }); }
    }
    let totals;
    try { totals = calculateUaeTotals(subtotal, deliveryFeeCents, Number(tax.rows[0].tax_rate_bps)); }
    catch { await client.query("ROLLBACK"); return res.status(400).json({ error: "Order total is invalid." }); }
    const vatCents = totals.vat_fils;
    const total = totals.total_fils;
    const inserted = await client.query(
      `INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_address,payment_method,payment_status,status,currency,subtotal_cents,delivery_fee_cents,vat_cents,tax_rate_bps,total_cents,shipping_country,idempotency_key,request_fingerprint)
       VALUES($1,$2,$3,$4,'binance','pending','pending_payment','AED',$5,$6,$7,$8,$9,'AE',$10,$11) RETURNING id,order_number`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,d.shipping_address + ", UAE",subtotal,deliveryFeeCents,vatCents,Number(tax.rows[0].tax_rate_bps),total,idempotencyKey,fingerprint]);
    order = inserted.rows[0];
    for (const [sku, qty] of quantities) {
      const v = found.rows.find(row => row.sku === sku);
      await client.query("INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [order.id,v.variant_id,sku,v.product_name,v.size_label,v.color_name,v.price_cents,qty,Number(v.price_cents)*qty,v.unit_cost_cents ?? null]);
      await client.query("INSERT INTO order_reservations(order_id,variant_id,quantity,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')", [order.id,v.variant_id,qty]);
    }
    await client.query("COMMIT");
  } catch (err) { if (client) await client.query("ROLLBACK").catch(()=>{}); return next(err); }
  finally { client?.release(); }

  try {
    const merchantTradeNo = "BF" + String(order.order_number);
    const total = await pool.query("SELECT total_cents FROM orders WHERE id=$1", [order.id]);
    const amount = (Number(total.rows[0].total_cents) / 100).toFixed(2);
    const payment = await createBinancePayOrder({
      merchantTradeNo, amount, description: "BF SHOES order #" + order.order_number,
      returnUrl: baseUrl + "/payment-result.html?order=" + encodeURIComponent(order.order_number)
    });
    await pool.query(
      "INSERT INTO payment_attempts(order_id,provider,txnid,provider_payment_id,amount_cents,currency,status,checkout_params) VALUES($1,'binance',$2,$3,$4,'AED','pending',$5::jsonb)",
      [order.id,merchantTradeNo,payment.prepayId,Number(total.rows[0].total_cents),JSON.stringify({
        checkout_url: payment.checkoutUrl, prepay_id: payment.prepayId, expire_time: payment.expireTime,
        fiat_amount: payment.fiatAmount, fiat_currency: payment.fiatCurrency,
        binance_total_fee: payment.totalFee, binance_currency: payment.currency
      })]);
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,'storefront.binance_payment.initiated','order',$1)", [String(order.id)]);
    return res.status(201).json({ data: { order_number: order.order_number, checkout: { redirect_url: payment.checkoutUrl } } });
  } catch (err) {
    await pool.query("UPDATE payment_attempts SET status='failed' WHERE order_id=$1 AND provider='binance' AND status='pending'", [order.id]).catch(()=>{});
    await pool.query("UPDATE orders SET payment_status='failed',status='cancelled',updated_at=now() WHERE id=$1 AND payment_status='pending'", [order.id]).catch(()=>{});
    await pool.query("DELETE FROM order_reservations WHERE order_id=$1", [order.id]).catch(()=>{});
    return res.status(502).json({ error: "Binance Pay could not create the payment session. No payment was taken." });
  }
});

storefrontRouter.post("/payments/binance/webhook", async (req, res, next) => {
  try {
    const rawBody = req.rawBody;
    const timestamp = req.get("BinancePay-Timestamp") || "";
    const nonce = req.get("BinancePay-Nonce") || "";
    const signature = req.get("BinancePay-Signature") || "";
    const serial = req.get("BinancePay-Certificate-SN") || "";
    if (!rawBody || !timestamp || !nonce || !signature || !serial) return res.status(400).json({ returnCode: "FAIL", returnMessage: "Missing signature headers" });
    const publicKey = await getBinancePayCertificate(serial);
    if (!verifyBinanceWebhookSignature({ timestamp, nonce, rawBody, signature, publicKey })) return res.status(401).json({ returnCode: "FAIL", returnMessage: "Invalid signature" });
    const payload = req.body || {};
    if (payload.bizType !== "PAY" || !["PAY_SUCCESS","PAY_CLOSED"].includes(payload.bizStatus)) {
      return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
    }
    let data;
    try { data = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data; } catch { return res.status(400).json({ returnCode: "FAIL", returnMessage: "Invalid event data" }); }
    const tradeNo = String(data?.merchantTradeNo || "");
    if (!/^BF\d{1,18}$/.test(tradeNo)) return res.status(400).json({ returnCode: "FAIL", returnMessage: "Invalid merchant trade number" });
    const found = await pool.query(
      `SELECT pa.*,o.id AS order_id,o.order_number,o.total_cents,o.currency,o.customer_email
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='binance' AND pa.txnid=$1`, [tradeNo]);
    if (!found.rowCount) return res.status(404).json({ returnCode: "FAIL", returnMessage: "Payment attempt not found" });
    const attempt = found.rows[0];
    if (attempt.status === "paid" || attempt.status === "paid_stock_review") return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
    if (payload.bizStatus === "PAY_CLOSED") {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("UPDATE payment_attempts SET status='failed',callback_payload=$1::jsonb,verified_at=now() WHERE id=$2 AND status='pending'", [JSON.stringify(payload),attempt.id]);
        await c.query("UPDATE orders SET payment_status='failed',status='cancelled',updated_at=now() WHERE id=$1 AND payment_status='pending'", [attempt.order_id]);
        await c.query("DELETE FROM order_reservations WHERE order_id=$1", [attempt.order_id]);
        await c.query("COMMIT");
      } catch (err) { await c.query("ROLLBACK").catch(()=>{}); throw err; } finally { c.release(); }
      return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
    }
    const verified = await queryBinancePayOrder(tradeNo);
    const expectedAmount = Number(attempt.amount_cents) / 100;
    const checkout = attempt.checkout_params || {};
    const expectedCryptoAmount = Number(checkout.binance_total_fee);
    const expectedCryptoCurrency = String(checkout.binance_currency || "");
    const paidAmount = Number(verified.totalFee);
    if (verified.status !== "PAID" || verified.merchantTradeNo !== tradeNo ||
        !expectedCryptoCurrency || verified.currency !== expectedCryptoCurrency ||
        !Number.isFinite(expectedCryptoAmount) || expectedCryptoAmount <= 0 ||
        !Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedCryptoAmount) > 0.00000001 ||
        !verified.transactionId || data.currency !== expectedCryptoCurrency ||
        Math.abs(Number(data.totalFee) - expectedCryptoAmount) > 0.00000001 ||
        String(checkout.fiat_currency) !== "AED" ||
        Math.abs(Number(checkout.fiat_amount) - expectedAmount) > 0.000001) {
      await pool.query("UPDATE payment_attempts SET status='review',callback_payload=$1::jsonb WHERE id=$2 AND status='pending'", [JSON.stringify(payload),attempt.id]);
      await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'", [attempt.order_id]);
      return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
    }
    const c = await pool.connect();
    let review = false;
    try {
      await c.query("BEGIN");
      const locked = await c.query("SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE", [attempt.id]);
      const order = await c.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [attempt.order_id]);
      if (locked.rows[0]?.status === "paid" || order.rows[0]?.payment_status === "paid") {
        await c.query("COMMIT");
        return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
      }
      const reservations = await c.query("SELECT variant_id,quantity FROM order_reservations WHERE order_id=$1 ORDER BY variant_id FOR UPDATE", [attempt.order_id]);
      const items = await c.query("SELECT count(DISTINCT variant_id)::int AS count FROM order_items WHERE order_id=$1", [attempt.order_id]);
      if (!reservations.rowCount || reservations.rowCount !== Number(items.rows[0].count)) review = true;
      for (const r of reservations.rows) {
        if (review) break;
        const v = await c.query("SELECT stock_qty,COALESCE((SELECT sum(quantity) FROM order_reservations WHERE variant_id=$1 AND order_id<>$2 AND expires_at>now()),0)::int AS reserved FROM variants WHERE id=$1 FOR UPDATE", [r.variant_id,attempt.order_id]);
        if (!v.rowCount || Number(v.rows[0].stock_qty) - Number(r.quantity) < Number(v.rows[0].reserved)) review = true;
      }
      if (!review) for (const r of reservations.rows) {
        await c.query("UPDATE variants SET stock_qty=stock_qty-$1,updated_at=now() WHERE id=$2", [r.quantity,r.variant_id]);
        await c.query("INSERT INTO inventory_movements(variant_id,delta,reason,reference_order_id) VALUES($1,$2,'storefront_binance_paid',$3)", [r.variant_id,-Number(r.quantity),attempt.order_id]);
        await allocateOrderWarehouseStock(c, { orderId: attempt.order_id, variantId: r.variant_id, quantity: Number(r.quantity), reason: "storefront_binance_paid" });
      }
      await c.query("DELETE FROM order_reservations WHERE order_id=$1", [attempt.order_id]);
      await c.query("UPDATE payment_attempts SET status=$1,provider_payment_id=$2,callback_payload=$3::jsonb,verified_at=now() WHERE id=$4", [review ? "paid_stock_review" : "paid",verified.transactionId,JSON.stringify(payload),attempt.id]);
      await c.query("UPDATE orders SET payment_status=$1,status=$2,updated_at=now() WHERE id=$3", [review ? "review" : "paid",review ? "confirmed" : "processing",attempt.order_id]);
      await c.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,$1,'order',$2)", [review ? "payment.paid.stock_review" : "payment.paid",String(attempt.order_id)]);
      await c.query("COMMIT");
    } catch (err) { await c.query("ROLLBACK").catch(()=>{}); throw err; } finally { c.release(); }
    if (!review) {
      try { await deliverEmail({ kind: "order_confirmation", recipient: attempt.customer_email, subject: "BF SHOES payment received for order #" + attempt.order_number, textBody: "Your BF SHOES Binance Pay payment has been verified. Order #" + attempt.order_number + " is now being processed." }); } catch {}
    }
    return res.status(200).json({ returnCode: "SUCCESS", returnMessage: null });
  } catch (err) { next(err); }
});


// UAE PayTabs hosted checkout. Checkout remains gated by verified owner settings,
// an active UAE VAT profile, AED catalogue prices, and a configured PayTabs account.
storefrontRouter.post("/orders/paytabs", async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your checkout details", details: parsed.error.flatten() });
  const suppliedKey = req.get("idempotency-key");
  if (!suppliedKey || suppliedKey.length < 16 || suppliedKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(suppliedKey)) return res.status(400).json({ error: "A valid Idempotency-Key is required" });
  const d = parsed.data;
  if (process.env.UAE_CHECKOUT_VERIFIED !== "true") return res.status(503).json({ error: "UAE online checkout remains disabled until the owner verifies PayTabs, VAT, AED pricing and delivery settings." });
  if (d.payment_method !== "paytabs") return res.status(400).json({ error: "Select PayTabs for UAE online checkout." });
  if (d.shipping_country !== "AE") return res.status(400).json({ error: "PayTabs checkout is only for the UAE market." });
  if (process.env.UAE_PRICING_VERIFIED !== "true") return res.status(503).json({ error: "UAE product pricing has not been owner-verified." });
  if (process.env.UAE_DELIVERY_FEE_VERIFIED !== "true") return res.status(503).json({ error: "UAE delivery fee has not been owner-verified." });
  if (!paytabsConfigured()) return res.status(503).json({ error: "PayTabs merchant credentials and HTTPS callback URL are not configured." });
  const deliveryFeeCents = Number(process.env.UAE_DELIVERY_FEE_FILS);
  if (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0) return res.status(503).json({ error: "UAE delivery fee is not configured." });
  const baseUrl = publicBaseUrl();
  const idempotencyKey = "store:" + suppliedKey;
  const fingerprint = storefrontRequestFingerprint({ ...d, shipping_country: "AE" });
  const quantities = aggregateStorefrontItems(d.items);
  if ([...quantities.values()].some(q => q > 10)) return res.status(400).json({ error: "Maximum quantity per size is 10" });
  let client;
  let order;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('bf-shoes-order-idempotency'))", [idempotencyKey]);
    const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      return res.status(409).json({ error: "This checkout key was already used. Start a fresh checkout session." });
    }
    const tax = await client.query("SELECT EXISTS (SELECT 1 FROM tax_profiles WHERE active=true AND jurisdiction='AE_VAT') AS configured");
    if (!tax.rows[0].configured) { await client.query("ROLLBACK"); return res.status(503).json({ error: "An active UAE VAT tax profile is required before checkout." }); }
    const skus = [...quantities.keys()].sort();
    const found = await client.query(
      `SELECT v.id AS variant_id,v.sku,v.size_label,v.color_name,v.stock_qty,v.stock_verified,
       COALESCE((SELECT sum(r.quantity) FROM order_reservations r WHERE r.variant_id=v.id AND r.expires_at>now()),0)::int AS reserved_qty,
       v.active AS variant_active,p.name AS product_name,p.price_cents,p.unit_cost_cents,p.currency,p.active AS product_active
       FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=ANY($1::text[]) ORDER BY v.sku FOR UPDATE OF v`, [skus]);
    if (found.rowCount !== skus.length || found.rows.some(v => !v.variant_active || !v.product_active || v.currency !== "AED")) {
      await client.query("ROLLBACK"); return res.status(409).json({ error: "Selected UAE products or sizes are unavailable." });
    }
    let subtotal=0;
    for (const [sku,qty] of quantities) {
      const v=found.rows.find(row=>row.sku===sku);
      if (!v.stock_verified) { await client.query("ROLLBACK"); return res.status(409).json({error:"Stock for "+v.product_name+" size "+v.size_label+" has not been physically verified yet."}); }
      if (Number(v.stock_qty)-Number(v.reserved_qty)<qty) { await client.query("ROLLBACK"); return res.status(409).json({error:"Insufficient available stock for "+v.product_name+" size "+v.size_label}); }
      subtotal += Number(v.price_cents)*qty;
    }
    const total=subtotal+deliveryFeeCents;
    if (!Number.isSafeInteger(total)||total<=0||total>2000000000) { await client.query("ROLLBACK"); return res.status(400).json({error:"Order total is invalid."}); }
    const inserted=await client.query(
      `INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_address,payment_method,payment_status,status,currency,subtotal_cents,delivery_fee_cents,total_cents,idempotency_key,request_fingerprint)
       VALUES($1,$2,$3,$4,'paytabs','pending','pending_payment','AED',$5,$6,$7,$8,$9)
       RETURNING id,order_number`,
      [d.customer_name,d.customer_email.toLowerCase(),d.customer_phone,d.shipping_address+", UAE",subtotal,deliveryFeeCents,total,idempotencyKey,fingerprint]);
    order=inserted.rows[0];
    for (const [sku,qty] of quantities) {
      const v=found.rows.find(row=>row.sku===sku);
      await client.query("INSERT INTO order_items(order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [order.id,v.variant_id,sku,v.product_name,v.size_label,v.color_name,v.price_cents,qty,Number(v.price_cents)*qty,v.unit_cost_cents ?? null]);
      await client.query("INSERT INTO order_reservations(order_id,variant_id,quantity,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')",[order.id,v.variant_id,qty]);
    }
    await client.query("COMMIT");
  } catch(err) { if(client) await client.query("ROLLBACK").catch(()=>{}); return next(err); }
  finally { client?.release(); }

  try {
    const cartId = "BF-" + String(order.order_number);
    const payment = await createPaytabsPayment({
      tran_type: "sale", tran_class: "ecom", cart_id: cartId,
      cart_currency: "AED", cart_amount: Number((Number(deliveryFeeCents) + Number((await pool.query("SELECT subtotal_cents FROM orders WHERE id=$1",[order.id])).rows[0].subtotal_cents))/100).toFixed(2),
      cart_description: "BF SHOES order #" + order.order_number,
      return: baseUrl + "/payment-result.html?provider=paytabs",
      callback: baseUrl + "/api/v1/store/payments/paytabs/callback",
      customer_details: { name:d.customer_name, email:d.customer_email.toLowerCase(), phone:d.customer_phone, street1:d.shipping_address, city:"UAE", state:"UAE", country:"AE" },
      shipping_details: { name:d.customer_name, email:d.customer_email.toLowerCase(), phone:d.customer_phone, street1:d.shipping_address, city:"UAE", state:"UAE", country:"AE" }
    });
    await pool.query("INSERT INTO payment_attempts(order_id,provider,txnid,provider_payment_id,amount_cents,currency,status,checkout_params) VALUES($1,'paytabs',$2,$3,$4,'AED','pending',$5::jsonb)",
      [order.id,cartId,payment.tran_ref,deliveryFeeCents + Number((await pool.query("SELECT subtotal_cents FROM orders WHERE id=$1",[order.id])).rows[0].subtotal_cents),JSON.stringify({redirect_url:payment.redirect_url,tran_ref:payment.tran_ref})]);
    return res.status(201).json({data:{order_number:order.order_number,checkout:{redirect_url:payment.redirect_url}}});
  } catch(err) {
    await pool.query("UPDATE payment_attempts SET status='failed' WHERE order_id=$1 AND provider='paytabs' AND status='pending'",[order.id]).catch(()=>{});
    await pool.query("UPDATE orders SET payment_status='failed',status='cancelled',updated_at=now() WHERE id=$1 AND payment_status='pending'",[order.id]).catch(()=>{});
    await pool.query("DELETE FROM order_reservations WHERE order_id=$1",[order.id]).catch(()=>{});
    return res.status(502).json({error:"PayTabs could not create the payment session. No payment was taken."});
  }
});

storefrontRouter.post("/payments/paytabs/callback", async (req,res,next) => {
  try {
    const rawBody=req.rawBody;
    const signature=req.get("signature") || "";
    if (!rawBody || !paytabsSignatureValid(rawBody,signature)) return res.status(400).send("Invalid payment callback signature.");
    const payload=req.body || {};
    const tranRef=String(payload.tran_ref || "");
    const cartId=String(payload.cart_id || "");
    if (!tranRef || !/^BF-\d+$/.test(cartId)) return res.status(400).send("Invalid payment reference.");
    const found=await pool.query(
      `SELECT pa.*,o.id AS order_id,o.order_number,o.total_cents,o.currency,o.customer_email
       FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
       WHERE pa.provider='paytabs' AND pa.provider_payment_id=$1 AND pa.txnid=$2`,[tranRef,cartId]);
    if (!found.rowCount) return res.status(404).send("Payment attempt not found.");
    const attempt=found.rows[0];
    const verified=await verifyPaytabsPayment(tranRef,cartId,Number(attempt.amount_cents),"AED");
    if (!verified.verified) {
      await pool.query("UPDATE payment_attempts SET status='review',callback_payload=$1::jsonb WHERE id=$2 AND status='pending'",[JSON.stringify(payload),attempt.id]);
      await pool.query("UPDATE orders SET payment_status='review',updated_at=now() WHERE id=$1 AND payment_status='pending'",[attempt.order_id]);
      return res.status(200).send("Payment requires review.");
    }
    const client=await pool.connect();
    let review=false;
    try {
      await client.query("BEGIN");
      const locked=await client.query("SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE",[attempt.id]);
      const order=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[attempt.order_id]);
      if (locked.rows[0]?.status==="paid" || order.rows[0]?.payment_status==="paid") { await client.query("COMMIT"); return res.status(200).send("Already processed."); }
      const reservations=await client.query("SELECT variant_id,quantity FROM order_reservations WHERE order_id=$1 ORDER BY variant_id FOR UPDATE",[attempt.order_id]);
      const items=await client.query("SELECT count(DISTINCT variant_id)::int AS count FROM order_items WHERE order_id=$1",[attempt.order_id]);
      if (!reservations.rowCount || reservations.rowCount!==Number(items.rows[0].count)) review=true;
      for(const r of reservations.rows) {
        if(review) break;
        const v=await client.query("SELECT stock_qty,COALESCE((SELECT sum(quantity) FROM order_reservations WHERE variant_id=$1 AND order_id<>$2 AND expires_at>now()),0)::int AS reserved FROM variants WHERE id=$1 FOR UPDATE",[r.variant_id,attempt.order_id]);
        if(!v.rowCount || Number(v.rows[0].stock_qty)-Number(r.quantity)<Number(v.rows[0].reserved)) review=true;
      }
      if(!review) for(const r of reservations.rows) {
        await client.query("UPDATE variants SET stock_qty=stock_qty-$1,updated_at=now() WHERE id=$2",[r.quantity,r.variant_id]);
        await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,reference_order_id) VALUES($1,$2,'storefront_paytabs_paid',$3)",[r.variant_id,-Number(r.quantity),attempt.order_id]);
        await allocateOrderWarehouseStock(client, { orderId: attempt.order_id, variantId: r.variant_id, quantity: Number(r.quantity), reason: "storefront_paytabs_paid" });
      }
      await client.query("DELETE FROM order_reservations WHERE order_id=$1",[attempt.order_id]);
      await client.query("UPDATE payment_attempts SET status=$1,callback_payload=$2::jsonb,verified_at=now() WHERE id=$3",[review?"paid_stock_review":"paid",JSON.stringify(payload),attempt.id]);
      await client.query("UPDATE orders SET payment_status=$1,status=$2,updated_at=now() WHERE id=$3",[review?"review":"paid",review?"confirmed":"processing",attempt.order_id]);
      await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('system',NULL,$1,'order',$2)",[review?"payment.paid.stock_review":"payment.paid",String(attempt.order_id)]);
      await client.query("COMMIT");
    } catch(err) { await client.query("ROLLBACK").catch(()=>{}); throw err; }
    finally { client.release(); }
    return res.status(200).send(review?"Payment received; stock review required.":"Payment verified.");
  } catch(err) { next(err); }
});


storefrontRouter.post("/orders", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check your checkout details", details: parsed.error.flatten() });
  return res.status(503).json({ error: "Direct order creation is disabled. Use the market-specific PayU or PayTabs route only after the owner verifies checkout setup." });
});
