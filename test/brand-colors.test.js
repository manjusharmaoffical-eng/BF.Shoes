import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');

test('BF SHOES announcement/product badges use the requested white, red and black brand palette', () => {
  assert.match(css, /background:\s*#c8102e/);
  assert.doesNotMatch(css, /\.product-tag\{[^}]*#119b4b/);
});
