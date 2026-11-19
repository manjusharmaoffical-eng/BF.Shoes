import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [business, admin, html, policies] = await Promise.all([
  readFile(new URL('../src/business.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/policies.js', import.meta.url), 'utf8')
]);

test('staff creation, role changes, activity and performance are owner-only', () => {
  assert.match(business, /businessRouter\.get\("\/team", ownerOnly/);
  assert.match(business, /businessRouter\.post\("\/team", ownerOnly/);
  assert.match(business, /businessRouter\.patch\("\/team\/:id", ownerOnly/);
  assert.match(business, /businessRouter\.get\("\/activity", ownerOnly/);
  assert.match(business, /businessRouter\.get\("\/performance", ownerOnly/);
  assert.match(business, /AND role <> 'admin'/);
});

test('manager and staff scopes remain least-privilege and distinct', () => {
  assert.match(business, /manager: \["products:read", "products:write", "inventory:read", "inventory:write", "orders:read", "orders:write"/);
  assert.match(business, /staff: \["products:read", "inventory:read", "orders:read", "analytics:read", "campaigns:read"\]/);
  assert.match(policies, /manager/);
  assert.match(policies, /staff/);
});

test('analytics is market-separated and labels order value as non-profit', () => {
  assert.match(business, /parseAnalyticsCurrency\(req\.query\.currency\)/);
  assert.match(business, /WHERE currency=\$1/);
  assert.match(business, /Order value is not profit/);
});

test('admin exposes staff creation, activation and role controls in the owner team panel', () => {
  assert.match(html, /id="team-panel"/);
  assert.match(html, /id="team-form"/);
  assert.match(html, /minlength="14"/);
  assert.match(admin, /req\('\/business\/team'/);
  assert.match(admin, /data-role-save/);
  assert.match(admin, /data-team/);
  assert.match(admin, /team:loadTeam/);
});
