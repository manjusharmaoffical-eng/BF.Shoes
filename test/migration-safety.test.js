import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [schema, migrate, pkg] = await Promise.all([
  readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/migrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse)
]);

test('schema migration does not drop tables/columns, truncate data or delete business records', () => {
  assert.doesNotMatch(schema, /DROP\s+TABLE\b|DROP\s+COLUMN\b|TRUNCATE\b|DELETE\s+FROM\b/i);
  assert.match(schema, /DROP CONSTRAINT IF EXISTS/);
});

test('catalog enrichment updates only descriptive attributes, never prices, costs or stock', () => {
  const updates = [...schema.matchAll(/UPDATE\s+products\b[\s\S]*?;/gi)].map(match => match[0]);
  assert.ok(updates.length >= 2);
  for (const update of updates) {
    assert.match(update, /SET\s+attributes\s*=/i);
    assert.doesNotMatch(update, /SET\s+[^;]*(price_cents|mrp_cents|unit_cost_cents|stock_qty)\s*=/i);
  }
});

test('production schema migration is explicit and never runs in preview builds', () => {
  assert.match(pkg.scripts['vercel-build'], /VERCEL_ENV.*production.*RUN_MIGRATIONS.*true/);
  assert.match(pkg.scripts['vercel-build'], /then node src\/migrate\.js/);
  assert.match(migrate, /readFile\(new URL\("\.\.\/schema\.sql"/);
});
