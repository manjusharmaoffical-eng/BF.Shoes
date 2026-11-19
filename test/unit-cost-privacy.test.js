import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [routes, admin] = await Promise.all([
  readFile(new URL('../src/routes.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8')
]);

test('only the owner can create or change actual product unit costs', () => {
  assert.match(routes, /const isOwner = actor => actor\?\.type === "admin" && actor\?\.role === "admin"/);
  assert.match(routes, /Only the owner can record actual product unit costs/);
  assert.match(routes, /Only the owner can update actual product unit costs/);
});

test('product reads and writes never return internal unit costs to managers, staff or API keys', () => {
  assert.match(routes, /if \(!isOwner\(req\.actor\)\) delete product\.unit_cost_cents/);
  assert.match(routes, /if \(!isOwner\(req\.actor\)\) delete created\.unit_cost_cents/);
  assert.match(routes, /if\(!isOwner\(req\.actor\)\)delete updated\.unit_cost_cents/);
});

test('order API responses and idempotent replays omit internal cost snapshots', () => {
  assert.match(routes, /unit_cost_cents: _internalCost, \.\.\.customerSafeItem/);
  assert.match(routes, /SELECT id,order_id,variant_id,sku,product_name,size_label,color_name,unit_price_cents,quantity,line_total_cents FROM order_items/);
  assert.doesNotMatch(routes, /SELECT \* FROM order_items/);
});

test('admin unit-cost editor and create-product cost input are owner-only', () => {
  assert.match(admin, /'#product-create-cost-field','#product-cost-form'/);
  assert.match(admin, /selector==='#product-create-cost-field'\|\|selector==='#product-cost-form'\?!owner/);
  assert.match(admin, /if\(actor\?\.role==='admin'&&cost!==null\)body\.unit_cost_cents/);
});


test('issued integration keys cannot receive API-key administration scope', () => {
  assert.match(routes, /INTEGRATION_SCOPES = ALL_SCOPES\.filter\(scope => scope !== "keys:write"\)/);
  assert.match(routes, /z\.array\(z\.enum\(INTEGRATION_SCOPES\)\)/);
  assert.match(routes, /product\.cost\.update/);
});
