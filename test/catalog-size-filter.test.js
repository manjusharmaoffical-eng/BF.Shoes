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
  assert.doesNotMatch(html, /id="catalog-sidebar"|id="mobile-filter-trigger"|id="product-sort"|class="view-toggle"|id="product-search"/);
  assert.doesNotMatch(html, /class="category-showcase"|data-category-jump=/);
  assert.equal((html.match(/href="\/men\.html"/g) || []).length, 1);
  assert.equal((html.match(/href="\/women\.html"/g) || []).length, 1);
  assert.equal((html.match(/href="\/collections\.html"/g) || []).length, 1);
  assert.doesNotMatch(app, /matchesSize|matchesColor/);
});

test('size and colour choices are scoped to the selected product detail view', () => {
  assert.match(app, /data-detail-size=/);
  assert.match(app, /data-detail-color=/);
  assert.match(app, /Select size/);
  assert.match(app, /Select colour/);
  assert.match(app, /colorNames\.length \?/);
  assert.match(app, /selectedColor/);
});
