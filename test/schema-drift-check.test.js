import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractSchemaExpectations } from '../scripts/check-schema-drift.js';
const [schema, script, pkg, runbook] = await Promise.all([
  readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/check-schema-drift.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../OPERATIONS-RUNBOOK.md', import.meta.url), 'utf8')
]);

test('schema drift checker discovers required tables, columns, and indexes from schema.sql', () => {
  const expected = extractSchemaExpectations(schema);
  assert.ok(expected.tables.size >= 30);
  assert.ok(expected.indexes.size >= 50);
  assert.ok(expected.tables.get('customer_wishlist').has('customer_id'));
  assert.ok(expected.tables.get('customer_wishlist').has('product_id'));
  assert.ok(expected.tables.get('orders').has('currency'));
});

test('schema drift checker is strictly read-only and never exposes the database URL', () => {
  assert.match(script, /BEGIN READ ONLY/);
  assert.match(script, /ROLLBACK/);
  assert.doesNotMatch(script, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|ALTER TABLE|CREATE TABLE|DROP TABLE)\b/i);
  assert.doesNotMatch(script, /console\.log\(.*DATABASE_URL/);
});

test('schema drift check is documented as an explicit operator command', () => {
  assert.equal(pkg.scripts['schema-check'], 'node scripts/check-schema-drift.js');
  assert.match(runbook, /npm run schema-check/);
});
