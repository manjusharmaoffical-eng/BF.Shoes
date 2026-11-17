import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [app, html] = await Promise.all([
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8')
]);

test('homepage and catalogue do not expose global size or colour filters', () => {
  assert.doesNotMatch(html, /data-size=/);
  assert.doesNotMatch(html, /data-color=/);
  assert.doesNotMatch(app, /catalog-sidebar \\[data-(?:size|color)\\]/);
  assert.doesNotMatch(app, /matchesSize|matchesColor/);
});

test('size and colour choices are scoped to the selected product detail view', () => {
  assert.match(app, /data-detail-size=/);
  assert.match(app, /data-detail-color=/);
  assert.match(app, /Select size/);
  assert.match(app, /Select colour/);
  assert.match(app, /selectedColor/);
});
