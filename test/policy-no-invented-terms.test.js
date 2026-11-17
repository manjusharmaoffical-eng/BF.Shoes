import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../frontend/policies.html', import.meta.url), 'utf8');

test('return policy does not invent a fixed return fee, return window or packaging rule', () => {
  assert.match(html, /No refund, return fee or stock adjustment is made automatically/);
  assert.match(html, /return window, eligibility rules.*not yet configured/);
  assert.doesNotMatch(html, /₹\s*100|within\s+\d+\s+days|unused and in their original packaging/);
});

test('store terms clearly disclose that prices and checkout are not fully verified', () => {
  assert.match(html, /market prices still require owner verification/);
  assert.match(html, /Checkout is currently unavailable/);
  assert.match(html, /placeholder email address is intentionally not shown/);
});
