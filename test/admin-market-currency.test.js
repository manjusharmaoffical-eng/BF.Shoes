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

test("policy page uses the existing SVG favicon instead of requesting a missing ICO", () => {
  const policies = readFileSync(new URL("../frontend/policies.html", import.meta.url), "utf8");
  assert.match(policies, /rel="icon"[^>]+href="\/favicon\.svg"/);
});

test('admin product editor exposes safe copy and image updates without changing prices', async () => {
  const html = readFileSync(new URL('../frontend/admin.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../frontend/admin.js', import.meta.url), 'utf8');
  assert.match(html, /id="product-edit-form"/);
  assert.match(html, /id="edit-product-image"/);
  assert.match(js, /data-edit-product/);
  assert.match(js, /method:'PATCH'/);
  assert.match(js, /Price and currency were not changed/);
  assert.match(js, /https:/);
});

test('product image gallery uses authenticated signed Cloudinary uploads and persistent gallery records', () => {
  const ai = readFileSync(new URL('../src/ai-studio.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../frontend/admin.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../frontend/admin.js', import.meta.url), 'utf8');
  assert.match(ai, /aiStudioRouter\.post\("\/product-images\/signature"/);
  assert.match(ai, /CLOUDINARY_API_SECRET/);
  assert.match(ai, /INSERT INTO product_images/);
  assert.match(ai, /isOwnedCloudinaryImage/);
  assert.match(ai, /product\.image\.primary/);
  assert.match(html, /id="product-gallery-form"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(js, /8\*1024\*1024/);
  assert.match(js, /Make primary/);
  assert.match(js, /product-gallery/);
});


test('Content Security Policy permits Cloudinary gallery image display and direct upload', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('"https://res.cloudinary.com"'));
  assert.ok(server.includes('"https://api.cloudinary.com"'));
  assert.match(server, /methods: \["GET", "POST", "PATCH", "DELETE", "OPTIONS"\]/);
});
