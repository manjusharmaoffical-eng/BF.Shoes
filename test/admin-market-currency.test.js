import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefront = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../frontend/admin.html", import.meta.url), "utf8");
const adminJs = readFileSync(new URL("../frontend/admin.js", import.meta.url), "utf8");

test("storefront market selector markup contains no escaped newline text", () => {
  assert.match(storefront, /id="market-selector"/);
  assert.doesNotMatch(storefront, /\\n\s*<label class="market-select-wrap">/);
});

test("admin product form exposes INR and AED currency choices", () => {
  assert.match(adminHtml, /name="currency"/);
  assert.match(adminHtml, /value="INR"/);
  assert.match(adminHtml, /value="AED"/);
  assert.match(adminHtml, /Unit cost \(same currency as product/);
});

test("admin saves and formats each product using its selected currency", () => {
  assert.match(adminJs, /currency:String\(f\.get\('currency'\)\|\|'INR'\)/);
  assert.match(adminJs, /money\(p\.price_cents,p\.currency\)/);
});
