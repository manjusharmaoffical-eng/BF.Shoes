#!/usr/bin/env bash
set -Eeuo pipefail

# Create and verify a PostgreSQL custom-format backup. Never writes inside the
# application source tree unless BACKUP_DIR explicitly points there.
: "${DATABASE_URL:?Set DATABASE_URL in the process environment (do not paste it into chat).}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/bf-shoes-db-backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required to verify the archive" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/bf-shoes-$stamp.dump"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT

umask 077
pg_dump --format=custom --no-owner --no-acl --file "$tmp" "$DATABASE_URL"
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$file"
chmod 600 "$file"
printf 'Verified backup created: %s\n' "$file"
sha256sum "$file"
