import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

test('AI copy and image generation have separate bounded rate limits on both route aliases', () => {
  assert.match(server, /const aiCopyLimiter = rateLimit\(\{ windowMs: 15 \* 60_000, limit: 10/);
  assert.match(server, /const aiImageLimiter = rateLimit\(\{ windowMs: 15 \* 60_000, limit: 3/);
  assert.match(server, /\["\/api\/v1\/ai\/product-copy", "\/api\/v1\/ai-studio\/product-copy"\], aiCopyLimiter/);
  assert.match(server, /\["\/api\/v1\/ai\/product-image", "\/api\/v1\/ai-studio\/product-image"\], aiImageLimiter/);
});
