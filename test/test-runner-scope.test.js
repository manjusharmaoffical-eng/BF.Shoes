import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('npm test runs only the maintained top-level test suite, not archived backup repositories', () => {
  assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
});


test('Vercel preview builds never migrate databases; production migrations require an explicit one-time gate', () => {
  assert.match(pkg.scripts['vercel-build'], /VERCEL_ENV.*production/);
  assert.match(pkg.scripts['vercel-build'], /RUN_MIGRATIONS.*true/);
});
