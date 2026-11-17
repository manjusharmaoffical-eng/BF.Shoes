import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const js = await readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8');

test('admin panel loads authenticated role scopes before showing owner-only sections', () => {
  assert.match(js, /req\('\/auth\/me'\)/);
  assert.match(js, /const owner=actor\?\.type==='admin'&&actor\?\.role==='admin'/);
  for (const tab of ['team','activity','communications','finance','invoices','ultron','returns']) {
    assert.match(js, new RegExp(`${tab}:owner`));
  }
  assert.match(js, /'api-keys':owner/);
});

test('staff and managers see only their permitted actions; read-only order users cannot update statuses', () => {
  assert.match(js, /can\('products:write'\)/);
  assert.match(js, /can\('inventory:write'\)/);
  assert.match(js, /can\('campaigns:write'\)/);
  assert.match(js, /actor\?\.scopes\|\|\[\]\)\.includes\('orders:write'\)/);
  assert.match(js, /:'Read only'/);
  assert.match(js, /includes\('products:write'\)\?'<button type=\"button\" data-edit-product/);
  assert.match(js, /canWrite=actor\?\.role==='admin'\|\|\(actor\?\.scopes\|\|\[\]\)\.includes\('campaigns:write'\)/);
});

test('role changes reset all panels and choose a permitted default instead of leaving an owner panel visible', () => {
  assert.match(js, /panel\.classList\.add\('hidden'\)/);
  assert.match(js, /firstAllowed\+'-panel'\)\?\.classList\.remove\('hidden'\)/);
});
