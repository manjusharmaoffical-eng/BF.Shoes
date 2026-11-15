import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
const admin = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const assets = await readdir(new URL("../frontend/assets/catalog/", import.meta.url));

test("catalog seeds 16 men's and women's styles in INR and AED", () => {
  assert.match(schema, /BF SHOES initial men and women footwear catalog/);
  assert.match(schema, /VALUES \('INR',69900,99900,'IN'\),\('AED',2725,3900,'AE'\)/);
  assert.match(schema, /ON CONFLICT \(slug\) DO NOTHING/);
  assert.equal((schema.match(/\('(men|women)-[a-z-]+','BF /g) || []).length, 16);
});

test("MRP is supported and inventory is not invented", () => {
  assert.match(schema, /ADD COLUMN IF NOT EXISTS mrp_cents/);
  assert.match(schema, /m\.mrp_cents/);
  assert.match(schema, /mrp_cents INTEGER CHECK \(mrp_cents IS NULL OR mrp_cents >= price_cents\)/);
  assert.match(schema, /\'women-wedge\',\'BF Riviera Wedge\',\'women\',\'heels-wedges\'/);
  assert.match(schema, /\'women-pump\',\'BF Signature Pump\',\'women\',\'heels-pumps\'/);
  assert.match(schema, /,0,TRUE\nFROM products p JOIN sizes/);
  assert.match(routes, /mrp_cents: z\.number\(\)\.int\(\)\.min\(0\)/);
  assert.match(admin, /mrp_cents:mrp===null\?null:Math\.round\(mrp\*100\)/);
});

test("all product illustrations carry BF branding and filters", async () => {
  assert.equal(assets.length, 16);
  for (const file of assets) {
    const svg = await readFile(new URL("../frontend/assets/catalog/" + file, import.meta.url), "utf8");
    assert.match(svg, /BF SHOES/);
    assert.match(svg, />BF<\/text>/);
  }
  assert.match(html, /data-category-jump="heels"/);
  assert.match(html, /data-category="stiletto"/);
});
