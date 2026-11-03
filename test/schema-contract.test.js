import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");

const requiredColumns = {
  products: ["unit_cost_cents", "short_description", "seo_title", "seo_description"],
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
  tax_invoices: ["invoice_number", "subtotal_cents", "total_cents"]
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

test("checkout schema keeps India COD delivery disabled until prices are configured", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.ok(storefront.includes("payment_method") && storefront.includes("'cod'"), "Storefront orders must remain COD-only");
  assert.match(storefront, /INR product pricing and delivery fee must be configured first/);
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

test("storefront exposes separate UAE and India market configuration", async () => {
  const storefront = await readFile(new URL("../src/storefront.js", import.meta.url), "utf8");
  assert.match(storefront, /storefrontRouter\.get\("\/market-config"/);
  assert.match(storefront, /currency: "INR"/);
  assert.match(storefront, /currency: "AED"/);
  assert.match(storefront, /PAYU_MERCHANT_KEY/);
  assert.match(storefront, /paymentProvider: "PayU"/);
  assert.match(storefront, /UAE_DELIVERY_FEE_FILS/);
  assert.match(storefront, /checkoutEnabled: false/);
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
