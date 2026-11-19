import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [dockerfile, pkg, compose] = await Promise.all([
  readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../compose.yaml', import.meta.url), 'utf8')
]);

test('Docker image matches the pinned Node engine and installs reproducibly from lockfile', () => {
  assert.match(dockerfile, /FROM node:24-alpine/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.equal(pkg.engines.node, '24.x');
});

test('self-hosted application container uses read-only filesystem and drops Linux capabilities', () => {
  const app = compose.split('\n  migrate:')[0];
  assert.match(app, /read_only: true/);
  assert.match(app, /cap_drop:\s*\n\s+- ALL/);
  assert.match(app, /no-new-privileges:true/);
  assert.match(app, /tmpfs:/);
});
