import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const migration = await readFile(new URL('../migrations/2026-11-17-wishlist-and-gallery-view-angle.sql', import.meta.url), 'utf8');

test('wishlist/gallery schema delta is additive, idempotent and transaction-wrapped', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /ALTER TABLE public\.product_images\s+ADD COLUMN IF NOT EXISTS view_angle TEXT NOT NULL DEFAULT 'detail'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.customer_wishlist/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS customer_wishlist_customer_created_idx/);
  assert.match(migration, /COMMIT;\s*$/);
});

test('schema delta never drops tables/columns/constraints or deletes/truncates business data', () => {
  assert.doesNotMatch(migration, /DROP\s+TABLE\b|DROP\s+COLUMN\b|DROP\s+CONSTRAINT\b|DELETE\s+FROM\b|TRUNCATE\b/i);
  assert.match(migration, /IF NOT EXISTS \([\s\S]*?product_images_view_angle_check[\s\S]*?ADD CONSTRAINT product_images_view_angle_check/);
});
