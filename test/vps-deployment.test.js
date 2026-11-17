import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [compose, guide, caddy, cronScript, service, timer, backupService, backupTimer] = await Promise.all([
  readFile(new URL('../compose.yaml', import.meta.url), 'utf8'),
  readFile(new URL('../VPS-DEPLOYMENT.md', import.meta.url), 'utf8'),
  readFile(new URL('../Caddyfile', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/run-email-outbox.sh', import.meta.url), 'utf8'),
  readFile(new URL('../deploy/systemd/bf-shoes-email-outbox.service', import.meta.url), 'utf8'),
  readFile(new URL('../deploy/systemd/bf-shoes-email-outbox.timer', import.meta.url), 'utf8'),
  readFile(new URL('../deploy/systemd/bf-shoes-db-backup.service', import.meta.url), 'utf8'),
  readFile(new URL('../deploy/systemd/bf-shoes-db-backup.timer', import.meta.url), 'utf8')
]);

test('VPS Compose keeps PostgreSQL private and app bound to localhost', () => {
  const db = compose.split('\n  app:')[0];
  assert.match(db, /image: postgres:16-alpine/);
  assert.match(db, /127\.0\.0\.1:5432:5432/);
  assert.doesNotMatch(db, /0\.0\.0\.0:5432/);
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /profiles: \["tools"\]/);
});

test('TLS reverse proxy is optional until approved DNS cutover', () => {
  assert.match(compose, /profiles: \["tls"\]/);
  assert.match(compose, /80:80/);
  assert.match(compose, /443:443/);
  assert.match(caddy, /bfshoes\.online, www\.bfshoes\.online/);
  assert.match(caddy, /reverse_proxy app:3000/);
  assert.match(guide, /only after the owner approves DNS cutover/);
});

test('VPS email scheduler uses HTTPS and never places the cron secret in the URL', () => {
  assert.match(cronScript, /https:\/\//);
  assert.match(cronScript, /printf 'header = "Authorization: Bearer %s/);
  assert.match(cronScript, /curl --config -/);
  assert.match(service, /EnvironmentFile=\/etc\/bf-shoes\/bf-shoes\.env/);
  assert.match(timer, /OnUnitActiveSec=5min/);
});


test('VPS runs a daily verified backup through the localhost-only PostgreSQL port', () => {
  assert.match(compose, /127\.0\.0\.1:5432:5432/);
  assert.match(backupService, /ExecStart=\/opt\/bf-shoes\/scripts\/backup-db\.sh/);
  assert.match(backupService, /ReadWritePaths=\/var\/backups\/bf-shoes/);
  assert.match(backupTimer, /OnCalendar=daily/);
  assert.match(guide, /encrypted off-server copy/);
});
