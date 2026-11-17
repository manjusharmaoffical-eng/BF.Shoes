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
  const nav = html.slice(html.indexOf('<nav class="everyday-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="everyday-nav"')) + 6);
  const footer = html.slice(html.indexOf('<div class="footer-bottom">'), html.indexOf('</div>', html.indexOf('<div class="footer-bottom">')) + 6);
  for (const href of ['/men.html','/women.html','/collections.html']) {
    assert.equal(nav.split('href="' + href + '"').length - 1, 1);
    assert.equal(footer.split('href="' + href + '"').length - 1, 0);
  }
  assert.match(html, /href="\/api\/v1\/store\/website-qr\.png"/);
  assert.match(html, /Customer Support/);
  assert.match(html, /href="\/shipping\.html"/);
  assert.match(html, /href="\/returns\.html"/);
  assert.doesNotMatch(app, /matchesSize|matchesColor/);
});

test('size and colour choices are scoped to the selected product detail view', () => {
  assert.match(app, /data-detail-size=/);
  assert.match(app, /data-detail-color=/);
  assert.ok(app.includes('<h3>Size</h3>'));
  assert.ok(app.includes('<h3>Colour</h3>'));
  assert.match(app, /colorNames\.length/);
  assert.match(app, /selectedColor/);
});
