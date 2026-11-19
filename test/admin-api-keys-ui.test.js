import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js, routes, policies] = await Promise.all([
  readFile(new URL('../frontend/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/policies.js', import.meta.url), 'utf8')
]);

test('owner admin exposes API key creation, scoped permissions, one-time secret display and revocation', () => {
  assert.match(html, /data-tab="api-keys"/);
  assert.match(html, /id="api-key-form"/);
  assert.match(html, /id="api-key-secret"[^>]*readonly/);
  assert.match(html, /id="copy-api-key"/);
  assert.match(html, /id="api-keys-table"/);
  assert.match(js, /req\('\/admin\/api-keys'/);
  assert.match(js, /req\('\/admin\/api-keys\/'.*\/revoke/);
  assert.match(js, /Secret values are never listed/);
});

test('API key secret is returned only at creation and key administration requires owner wildcard scope', () => {
  assert.match(routes, /requireScope\("keys:write"\)/);
  assert.match(routes, /secret: key\.raw/);
  assert.match(routes, /warning: "Copy now\. The secret will not be shown again\."/);
  assert.match(policies, /if \(role === "admin"\) return \["\*"\]/);
  assert.doesNotMatch(policies, /MANAGER_SCOPES[^\n]*keys:write/);
});


test('API key expiry must be a future timestamp', () => {
  assert.match(routes, /API key expiry must be in the future/);
});
