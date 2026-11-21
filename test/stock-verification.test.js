import test from "node:test";
import assert from "node:assert/strict";
import { hideUnverifiedPriceClaims } from "../src/storefront-policies.js";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../schema.sql");
const migration = read("../migrations/2026-11-17-variant-stock-verification.sql");
const storefront = read("../src/storefront.js");
const routes = read("../src/routes.js");
const warehouse = read("../src/warehouse.js");
const app = read("../frontend/app.js");
const admin = read("../frontend/admin.js");
const adminHtml = read("../frontend/admin.html");

test("variant stock defaults to unverified and the migration is additive", () => {
  assert.match(schema, /stock_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS stock_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT)|DELETE\s+FROM|TRUNCATE/i);
});

test("public catalog never advertises unverified quantities or unverified market prices", () => {
  assert.match(storefront, /CASE WHEN v\.stock_verified THEN v\.stock_qty ELSE 0 END/);
  assert.match(storefront, /'stock_verified', v\.stock_verified/);
  assert.match(storefront, /price_pending_conversion: !priceVerified/);
  assert.match(storefront, /price_cents: priceVerified \? product\.price_cents : null/);
  assert.match(storefront, /mrp_cents: priceVerified \? product\.mrp_cents : null/);
});

test("all shopper and staff order paths reject stock without a physical verification", () => {
  assert.match(storefront, /if\(!v\.stock_verified\)/);
  assert.match(storefront, /if \(!v\.stock_verified\)/);
  assert.match(routes, /if \(!v\.stock_verified\)/);
});

test("only explicit physical counts mark variants stock verified", () => {
  assert.match(routes, /UPDATE variants SET stock_qty=\$1,stock_verified=true,updated_at=now\(\) WHERE id=\$2/);
  const adjustmentRoute = routes.split('router.patch("/inventory/:sku"')[1]?.split("const orderSchema")[0] || "";
  assert.doesNotMatch(adjustmentRoute, /stock_verified\s*=\s*true/);
  assert.doesNotMatch(warehouse, /stock_verified\s*=\s*true/);
});

test("manual and warehouse stock adjustments are audit logged", () => {
  assert.match(routes, /'inventory\.stock\.adjust'/);
  assert.match(warehouse, /'warehouse\.stock\.adjust'/);
  assert.match(routes, /INSERT INTO audit_events\(actor_type,actor_id,action,resource_type,resource_id\)/);
  assert.match(warehouse, /INSERT INTO audit_events\(actor_type,actor_id,action,resource_type,resource_id\)/);
});

test("owner and inventory staff can record an exact physical count safely", () => {
  assert.match(routes, /router\.put\("\/inventory\/:sku\/count"/);
  assert.match(routes, /Counted stock cannot be lower than warehouse-assigned units/);
  assert.match(admin, /stock-count-form/);
  assert.match(adminHtml, /Counted quantity/);
});

test("storefront and admin clearly label pending physical stock counts", () => {
  assert.match(app, /Stock check pending/);
  assert.match(app, /Stock verification pending/);
  assert.match(admin, /Pending physical count/);
});

test("public catalog removes unverified currency amounts from product descriptions and attributes", () => {
  const product = {
    name: "BF SPEED RUN ₹699",
    slug: "bf-speed-run-₹699",
    brand: "BF SHOES AED 199",
    category: "Shoes Rs. 499",
    audience: "Kids INR 199",
    product_type: "Running Rs. 299",
    description: "Classic black-and-white sneaker. Owner-confirmed selling price ₹699 INR. Size variants still need setup.",
    short_description: "Verified India price ₹777. Sizes and stock pending setup.",
    attributes: {
      design_detail: "India catalog entry. Owner-confirmed selling price ₹699 INR. Black-and-white finish.",
      fit_notes: "Use UK size guide.",
      gallery_views: ["front", "back"],
      promo_note: "Limited offer ₹ 1,000 pending verification."
    },
    price_cents: null,
    mrp_cents: null,
    price_pending_conversion: true
  };
  const safe = hideUnverifiedPriceClaims(product);
  assert.equal(safe.name, "BF SPEED RUN");
  assert.equal(safe.slug, "bf-speed-run");
  assert.equal(safe.brand, "BF SHOES");
  assert.equal(safe.category, "Shoes");
  assert.equal(safe.audience, "Kids");
  assert.equal(safe.product_type, "Running");
  assert.equal(safe.description, "Classic black-and-white sneaker. Size variants still need setup.");
  assert.equal(safe.short_description, "Sizes and stock pending setup.");
  assert.equal(safe.attributes.design_detail, "India catalog entry. Black-and-white finish.");
  assert.equal(safe.attributes.fit_notes, "Use UK size guide.");
  assert.deepEqual(safe.attributes.gallery_views, ["front", "back"]);
  assert.equal(Object.hasOwn(safe.attributes, "promo_note"), false);
  assert.equal(safe.price_cents, null);
  assert.equal(safe.mrp_cents, null);
});
