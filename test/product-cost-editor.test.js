import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin exposes a separate actual unit cost editor in the product currency", async () => {
  const html = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  assert.match(html, /id="product-cost-form"/);
  assert.match(html, /id="product-cost-id"/);
  assert.match(html, /id="product-cost-value"/);
  assert.match(html, /product's own currency/);
  assert.match(js, /data-currency=/);
  assert.match(js, /Actual unit cost \(' \+ currency \+ '\)/);
});

test("saving actual unit cost sends only unit_cost_cents and preserves selling price", async () => {
  const js = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
  const start = js.indexOf("$('#product-cost-form').onsubmit=");
  const end = js.indexOf("\n", start);
  const handler = js.slice(start, end < 0 ? undefined : end);
  assert.match(handler, /unit_cost_cents:Math\.round\(amount\*100\)/);
  assert.doesNotMatch(handler, /price_cents/);
  assert.match(handler, /historical order costs were not rewritten/);
});

test("product update accepts unit cost and orders snapshot cost at order creation", async () => {
  const [routes, storefront, finance] = await Promise.all([
    readFile(new URL("../src/routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../src/finance.js", import.meta.url), "utf8")
  ]);
  assert.match(routes, /unit_cost_cents: z\.number\(\)\.int\(\)\.min\(0\).*\.nullable\(\)\.optional\(\)/);
  assert.match(routes, /v\.unit_cost_cents \?\? null/);
  assert.match(storefront, /v\.unit_cost_cents \?\? null/);
  assert.match(finance, /units_missing_cost/);
});
