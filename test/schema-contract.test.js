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
