import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");

const requiredColumns = {
  products: ["unit_cost_cents", "short_description", "seo_title", "seo_description", "category", "audience", "product_type", "attributes"],
  variants: ["sku", "stock_qty", "active"],
  orders: ["request_fingerprint", "delivery_fee_cents", "total_cents", "payment_method"],
  order_items: ["unit_cost_cents", "line_total_cents"],
  inventory_movements: ["reference_order_id"],
  finance_expenses: ["amount_cents", "expense_date", "currency"],
  finance_funding: ["principal_cents", "interest_rate_bps", "start_date"],
  finance_repayments: ["funding_id", "principal_cents", "interest_cents", "paid_date"],
  product_images: ["product_id", "image_url"],
  campaigns: ["kind", "status", "starts_at", "ends_at"],
  tax_profiles: ["jurisdiction", "tax_rate_bps", "currency"],
  tax_invoices: ["invoice_number", "subtotal_cents", "total_cents"],
  return_requests: ["order_id", "customer_id", "request_type", "status", "reviewed_by"],
  return_request_items: ["request_id", "order_item_id", "quantity", "requested_size"],
  return_request_events: ["request_id", "actor_type", "from_status", "to_status"]
};

test("schema.sql contains the required business tables and columns", () => {
  for (const [table, columns] of Object.entries(requiredColumns)) {
    assert.match(
      schema,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i"),
      `Missing table definition: ${table}`
    );
    for (const column of columns) {
      assert.match(
        schema,
        new RegExp(`\\b${column}\\b`, "i"),
        `Missing required column declaration: ${table}.${column}`
      );
    }
  }
});

test("checkout schema accepts PayU and PayTabs behind market behind verification gates", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /payment_method:\s*z\.enum\(\["payu", "payu_qr", "paytabs", "cod"\]\)/, "Checkout schema must accept the supported online methods and COD");
  assert.match(storefront, /storefrontRouter\.use\(codRouter\)/);
  assert.match(storefront, /India online checkout is configured for PayU only/);
  assert.match(storefront, /paymentProvider: "PayU"/);
  assert.match(storefront, /payuConfigured\(\)/);
  assert.match(storefront, /INDIA_CHECKOUT_VERIFIED !== "true"/);
  assert.ok(storefront.includes('storefrontRouter.post("/payments/payu/callback"'));
  assert.ok(storefront.includes('storefrontRouter.post("/payments/payu/webhook"'));
  assert.match(storefront, /verifyPayuPayment\(txnid/);
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.match(app, /\/orders\/payu/);
  assert.match(app, /payuForm\.submit\(\)/);
  assert.match(app, /https:\/\/secure\.payu\.in\/_payment/);
});


test("catalog supports shoes, watches, eyewear and age/audience segmentation", async () => {
  const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
  const admin = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  for (const category of ["shoes", "watches", "eyewear"]) assert.match(routes, new RegExp(category));
  for (const audience of ["men", "women", "kids", "unisex"]) assert.match(routes, new RegExp(audience));
  assert.match(admin, /name="category"/);
  assert.match(admin, /name="audience"/);
  assert.match(script, /category:f\.get\('category'\)/);
});


test("public catalog exposes family and audience fields for customer filters", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.match(storefront, /to_jsonb\(p\)->>'category'/);
  assert.match(storefront, /to_jsonb\(p\)->>'audience'/);
  assert.match(storefront, /to_jsonb\(p\)->>'product_type'/);
  assert.match(storefront, /to_jsonb\(p\)->'attributes'/);
  assert.doesNotMatch(app, /state\.categories|matchesCategory/);
  assert.match(html, /href="\/watches\.html">WATCHES<\/a>/);
  assert.match(html, /href="\/eyewear\.html">EYEWEAR<\/a>/);
  assert.doesNotMatch(html, /data-category=/);
});


test("finance ledger supports separate INR and AED books without currency conversion", async () => {
  const finance = await readFile(new URL("../src/finance.js", import.meta.url), "utf8");
  assert.match(schema, /currency IN \('INR','AED'\)/);
  assert.match(finance, /currency:z\.enum\(\["INR","AED"\]\)/);
  assert.match(finance, /currency,sales:s/);
  assert.doesNotMatch(finance, /currency:\s*"INR",sales:s/);
});


test("admin product creation supports explicit AED and INR pricing", async () => {
  const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
  const adminHtml = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
  const adminJs = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  assert.match(routes, /currency: z\.enum\(\["AED", "INR"\]\)/);
  assert.match(adminHtml, /name="currency"[\s\S]*value="AED"[\s\S]*value="INR"/);
  assert.match(adminJs, /currency:String\(f\.get\('currency'\)\|\|'INR'\)/);
  assert.match(adminJs, /money\(p\.price_cents,p\.currency\)/);
});


test("homepage has one current BF hero and no duplicate legacy hero markup or imagery", async () => {
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Good design[\s\S]*doesn’t need/);
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.equal((html.match(/<section class="hero hero-reference"/g) || []).length, 1);
  assert.match(html, /WELCOME TO BF SHOES/);
  assert.match(html, /href="\/about\.html">About/);
  assert.match(css, /background-image:url\('\/assets\/bf-home-hero\.jpeg'\)/);
  assert.doesNotMatch(css, /images\.unsplash\.com|banner-left-shoe\.jpg/);
  assert.match(css, /#c8102e/);
});


test("public catalog remains readable before optional category columns are migrated", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /to_jsonb\(p\)->>'category'/);
  assert.match(storefront, /to_jsonb\(p\)->>'audience'/);
  assert.match(storefront, /to_jsonb\(p\)->'attributes'/);
});


test("CSP allows secure HTTPS product images without weakening script sources", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /"img-src":\s*\["\x27self\x27", "data:", "https:", "https:\/\/res\.cloudinary\.com"\]/);
  assert.match(server, /getDefaultDirectives\(\)/);
  assert.match(server, /"form-action": \["'self'", "https:\/\/test\.payu\.in", "https:\/\/secure\.payu\.in"\]/);
  assert.doesNotMatch(server, /scriptSrc:\s*\[[^\]]*https:/);
});

test("homepage product cards use local BF artwork when catalog image URLs are missing", async () => {
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../frontend/styles.css", import.meta.url), "utf8");
  assert.match(app, /FALLBACK_IMAGE\s*=\s*['"]\/assets\/bf-speed-run-product\.jpeg['"]/);
  assert.match(app, /const productImage = product => normalizeImageUrl\(product\?\.image_url\) \|\| productFallback\(product\)/);
  assert.match(app, /const productFallback = product => \/speed\[- \]run\/i/);
  const placeholder = await readFile(new URL("../frontend/assets/bf-product-placeholder.svg", import.meta.url), "utf8");
  assert.match(placeholder, /BF/);
  assert.doesNotMatch(app, /images\.unsplash\.com/);
  assert.match(css, /\.product-image\{background:#07080a\}/);
  assert.match(css, /\.product-image img\{display:block;object-fit:contain;padding:0;mix-blend-mode:normal;filter:none\}/);
});

test("storefront catalog respects the active market currency", async () => {
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("const marketCurrency = state.market === 'AE' ? 'AED' : 'INR'"));
  assert.match(app, /const marketProducts = state\.products\.filter\(product => product\.currency === marketCurrency\)/);
  assert.match(app, /state\.checkoutReady = onlineReady \|\| codReady/);
});


test("delivery fee has no implicit default and legacy migrations drop it", () => {
  assert.match(schema, /delivery_fee_cents INTEGER NOT NULL CHECK \(delivery_fee_cents >= 0\)/);
  assert.match(schema, /ALTER COLUMN delivery_fee_cents DROP DEFAULT/);
  assert.doesNotMatch(schema, /delivery_fee_cents INTEGER NOT NULL DEFAULT 5000/);
});

test("storefront never assumes a delivery fee amount", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /INDIA_DELIVERY_FEE_PAISE/);
  assert.match(storefront, /Number\.isSafeInteger\(deliveryFeeCents\)/);
  assert.match(storefront, /currency !== "INR"/);
  assert.doesNotMatch(storefront, /,\s*5000\s*,/);
});

test("storefront exposes separate UAE and India market configuration with owner-only checkout preview", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /storefrontRouter\.get\("\/market-config"/);
  assert.match(storefront, /currency: "INR"/);
  assert.match(storefront, /currency: "AED"/);
  assert.match(storefront, /payuConfigured\(\)/);
  assert.match(storefront, /paymentProvider: "PayU"/);
  assert.match(storefront, /paymentProvider: "PayTabs"/);
  assert.match(storefront, /checkoutEnabled: indiaCheckoutEnabled/);
  assert.match(storefront, /checkoutEnabled: uaeCheckoutEnabled/);
  assert.match(storefront, /UAE_DELIVERY_FEE_FILS/);
  assert.match(storefront, /storefrontRouter\.post\("\/orders\/paytabs"/);
  assert.match(storefront, /storefrontRouter\.post\("\/payments\/paytabs\/callback"/);
  assert.match(storefront, /const indiaCheckoutEnabled = process\.env\.INDIA_CHECKOUT_VERIFIED === "true"/);
  assert.match(storefront, /const uaeCheckoutEnabled = process\.env\.UAE_CHECKOUT_VERIFIED === "true"/);
  assert.doesNotMatch(storefront, /const (?:india|uae)CheckoutEnabled = true/);
});

test("public India GST status is not reported as registered before a valid tax profile exists", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  const marketPolicy = await readFile(new URL("../src/india-market-policy.js", import.meta.url), "utf8");
  assert.match(marketPolicy, /export function resolveIndiaGstStatus/);
  assert.match(storefront, /resolveIndiaGstStatus\(env\.gstStatus, taxProfile\)/);
  assert.match(storefront, /gst_status: gstStatus/);
});

test("public product catalog selects currency by explicit market", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /req\.query\.market \|\| "IN"/);
  assert.match(storefront, /market === "IN" \? "INR" : market === "AE" \? "AED"/);
  assert.match(storefront, /p\.currency = \$1/);
  assert.match(storefront, /shipping_country: z\.enum\(\["IN", "AE"\]\)\.default\("IN"\)/);
});

test("new product records default to AED without rewriting existing prices", () => {
  assert.match(schema, /currency CHAR\(3\) NOT NULL DEFAULT 'AED'/);
  assert.match(schema, /ALTER TABLE products ALTER COLUMN currency SET DEFAULT 'AED'/);
});


test("finance expenses and funding support INR and AED without combining currencies", async () => {
  const finance = await readFile(new URL("../src/finance.js", import.meta.url), "utf8");
  assert.match(schema, /currency CHAR\(3\) NOT NULL DEFAULT 'INR' CHECK \(currency IN \('INR','AED'\)\)/);
  assert.match(schema, /finance_expenses_currency_check CHECK \(currency IN \('INR','AED'\)\)/);
  assert.match(schema, /ALTER TABLE finance_funding ADD COLUMN IF NOT EXISTS currency CHAR\(3\) NOT NULL DEFAULT 'INR'/);
  assert.match(finance, /currency:z.enum\(\["INR","AED"\]\).default\("INR"\)/);
  assert.match(finance, /o\.currency=\$3/);
  assert.match(finance, /finance_expenses WHERE currency=\$3/);
  assert.match(finance, /f\.currency=\$1/);
  assert.match(finance, /currency,sales:s/);
});


test("India checkout readiness is not blocked by the separate UAE AED catalog", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.doesNotMatch(storefront, /currencies\.rows\.some\(row => row\.currency !== "INR"/);
  assert.match(storefront, /no_inr_priced_products/);
  assert.match(storefront, /v\.currency!=="INR"/);
});

test("website QR endpoint renders a real PNG for the official BF SHOES domain", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.dependencies?.qrcode, "The QR renderer must be a production dependency");
  assert.match(storefront, /QRCode\.toBuffer/);
  assert.match(storefront, /storefrontRouter\.get\("\/website-qr\.png"/);
  assert.match(storefront, /QRCode\.toBuffer/);
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /api\/v1\/store\/website-qr\.png/);
  assert.match(html, /alt="QR code that opens the BF SHOES website"/);
});


test("secure PayU checkout QR is transaction-specific, time-limited and status-checkable", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  const payPage = await readFile(new URL("../frontend/pay.js", import.meta.url), "utf8");
  assert.match(storefront, /payment_method: z\.enum\(\["payu", "payu_qr", "paytabs", "cod"\]\)/);
  assert.match(storefront, /randomBytes\(24\)\.toString\("hex"\)/);
  assert.match(storefront, /qr_expires_at/);
  assert.match(storefront, /qrUrl\.hash/);
  assert.match(storefront, /expirePayuQrAttempt/);
  assert.match(storefront, /payment\.qr\.expired/);
  assert.match(storefront, /paymentQrEnabled: indiaPayuConfigured/);
  assert.match(storefront, /storefrontRouter\.get\("\/payments\/payu\/qr"/);
  assert.match(storefront, /storefrontRouter\.get\("\/payments\/payu\/qr-status"/);
  assert.match(storefront, /order_reservations WHERE order_id=\$1/);
  assert.match(app, /payment_method: String\(formData\.get\('payment_method'\)/);
  assert.match(app, /payload\.payment_method === 'cod'/);
  assert.match(app, /payu-qr-status/);
  assert.match(html, /value="payu_qr"/);
  assert.match(payPage, /https:\/\/secure\.payu\.in\/_payment/);
  assert.match(payPage, /form\.submit\(\)/);
  assert.match(payPage, /new URLSearchParams\(window\.location\.hash/);
  assert.match(payPage, /Authorization:/);
});


test("closing the payment QR panel does not expose an empty checkout error", async () => {
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.match(app, /for \(const selector of \['\.form-grid', '\.payment-options', '\.checkout-summary', '#place-order', '\.privacy-note'\]/);
  assert.match(app, /if \(show\) \$\('#checkout-error'\)\?\.classList\.add\('hidden'\)/);
});

test("unverified, missing or non-positive product prices never become a zero-price cart item", async () => {
  const app = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.match(app, /const hasVerifiedPrice = product =>/);
  assert.match(app, /Number\.isSafeInteger\(cents\) && cents > 0/);
  assert.match(app, /hasVerifiedPrice\(item\)/);
  assert.match(app, /if \(!hasVerifiedPrice\(product\) \|\| product\?\.currency !== activeCurrency\)/);
  assert.match(app, /priceReady \? money\(product\.price_cents, product\.currency\) : 'Price verification pending'/);
  assert.match(app, /const moneyLine = priceReady/);
  assert.match(app, /const mrpLine = priceReady && Number\.isSafeInteger\(mrpCents\)/);
  assert.match(app, /Number\(product\.stock_qty\) <= 0 \|\| !priceReady/);
});
