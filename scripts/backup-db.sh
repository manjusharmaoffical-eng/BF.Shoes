#!/usr/bin/env bash
set -Eeuo pipefail

# Create and verify a PostgreSQL custom-format backup. Never writes inside the
# application source tree unless BACKUP_DIR explicitly points there. The URL
# password is written to a mode-600 temporary .pgpass file, never pg_dump argv.
: "${DATABASE_URL:?Set DATABASE_URL in the process environment (do not paste it into chat).}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/bf-shoes-db-backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required to verify the archive" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required to parse DATABASE_URL safely" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/bf-shoes-$stamp.dump"
tmp="$file.partial"
pgpass_file="$(mktemp "$BACKUP_DIR/.pgpass.XXXXXX")"
chmod 600 "$pgpass_file"
trap 'rm -f "$tmp" "$pgpass_file"' EXIT

umask 077
BACKUP_TMP="$tmp" PGPASS_FILE="$pgpass_file" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
const host = url.hostname;
const port = url.port || '5432';
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
if (!host || !database || !user || !password) throw new Error('DATABASE_URL is missing a required connection field');
const escapePassfile = value => String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
writeFileSync(process.env.PGPASS_FILE,
  [host, port, database, user, password].map(escapePassfile).join(':') + '\n', { mode: 0o600 });
const env = { ...process.env, PGPASSFILE: process.env.PGPASS_FILE };
delete env.DATABASE_URL;
for (const [query, variable] of [
  ['sslmode', 'PGSSLMODE'], ['channel_binding', 'PGCHANNELBINDING'],
  ['connect_timeout', 'PGCONNECT_TIMEOUT'], ['application_name', 'PGAPPNAME'],
  ['target_session_attrs', 'PGTARGETSESSIONATTRS']
]) {
  const value = url.searchParams.get(query);
  if (value) env[variable] = value;
}
const args = [
  '--format=custom', '--no-owner', '--no-acl', '--file', process.env.BACKUP_TMP,
  '--host', host, '--port', port, '--username', user, '--dbname', database
];
const result = spawnSync('pg_dump', args, { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
JS
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$file"
chmod 600 "$file"
printf 'Verified backup created: %s\n' "$file"
sha256sum "$file"
