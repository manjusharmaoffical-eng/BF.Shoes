import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../scripts/backup-db.sh', import.meta.url), 'utf8');

test('database backup uses a private temporary pgpass file instead of exposing DATABASE_URL in pg_dump argv', () => {
  assert.match(script, /PGPASSFILE/);
  assert.match(script, /delete env\.DATABASE_URL/);
  assert.match(script, /mode: 0o600/);
  assert.match(script, /--host', host/);
  assert.match(script, /--username', user/);
  assert.doesNotMatch(script, /pg_dump[^\n]*DATABASE_URL/);
  assert.match(script, /pg_restore --list/);
  assert.match(script, /chmod 700/);
  assert.match(script, /chmod 600/);
});
