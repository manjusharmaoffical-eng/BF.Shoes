import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/2026-11-17-notification-outbox-kinds.sql', import.meta.url), 'utf8');

test('notification outbox migration is transaction-wrapped and repeatable', () => {
  assert.match(migration, /^--[\\s\\S]*?BEGIN;/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS notification_outbox_kind_check/);
  assert.match(migration, /ADD CONSTRAINT notification_outbox_kind_check[\\s\\S]*?CHECK \\(kind IN \\('order_confirmation','newsletter_welcome','order_status_update','return_status_update'\\)\\)/);
  assert.match(migration, /COMMIT;\\s*$/);
});

test('notification outbox migration changes only the intended check constraint', () => {
  assert.doesNotMatch(migration, /DROP\\s+TABLE\\b|DROP\\s+COLUMN\\b|DELETE\\s+FROM\\b|TRUNCATE\\b/i);
  assert.equal((migration.match(/DROP CONSTRAINT/gi) || []).length, 1);
  assert.equal((migration.match(/ADD CONSTRAINT/gi) || []).length, 1);
  assert.match(migration, /ALTER TABLE public\\.notification_outbox/);
});
