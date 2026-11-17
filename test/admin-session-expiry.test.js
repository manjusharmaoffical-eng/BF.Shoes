import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const js = await readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8');

test('admin UI clears expired tokens and returns to sign-in after API 401', () => {
  assert.match(js, /const expireAdminSession=\(\)=>\{token='';/);
  assert.match(js, /if\(r\.status===401\)\{expireAdminSession\(\)/);
  assert.match(js, /Admin session expired\. Sign in again\./);
});
