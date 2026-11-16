# BF SHOES operations runbook

## Database backups

The helper `scripts/backup-db.sh` creates a PostgreSQL custom-format dump and verifies that PostgreSQL can read its archive directory before reporting success.

1. Run it only from a trusted machine with `pg_dump`, `pg_restore`, and the production `DATABASE_URL` available in that machine's private environment.
2. By default, files are written to `$HOME/bf-shoes-db-backups`, outside the repository. Set `BACKUP_DIR` only to a private, encrypted volume if a different location is required.
3. The script uses restrictive directory/file permissions, writes to a temporary `.partial` file, verifies the archive, then renames it to `.dump` and prints a SHA-256 checksum.
4. Copy verified dumps to a separate encrypted storage location. Do not commit backups or upload them to public storage.
5. Retain multiple dated backups according to the business' recovery needs. No scheduled backup is configured by this repository; schedule it only on a host with reliable storage, secure environment variables, monitoring, and an agreed retention policy.

Example (run in a private shell where DATABASE_URL is already set):

```sh
bash scripts/backup-db.sh
```

## Restore drill (never run against production as a test)

1. Provision a separate, empty PostgreSQL database with a restricted restore user.
2. Select a verified dump and inspect its contents:

```sh
pg_restore --list /secure/path/bf-shoes-YYYYMMDDTHHMMSSZ.dump
```

3. Restore only into the disposable test database:

```sh
pg_restore --no-owner --no-acl --exit-on-error \
  --dbname "$RESTORE_DATABASE_URL" \
  /secure/path/bf-shoes-YYYYMMDDTHHMMSSZ.dump
```

4. Compare schema/table counts and run the application test suite against the restored test database using a dedicated test environment. Never point a restore drill at the production connection string.
5. Record the dump checksum, restore date, duration, and any errors. A backup is not considered recovery-ready until a restore has succeeded.

## Release and rollback safety

- Keep code changes on a feature branch until syntax checks, automated tests, and `git diff --check` pass.
- Review database migrations before applying them. Take and verify a database backup first.
- Do not deploy migrations automatically from an unreviewed local branch.
- Verify the production health endpoint and key public pages after a release. Use an authenticated admin session for operational workflows; do not bypass authentication or use live customer data for tests.
- Roll back application code through the hosting provider's previous known-good deployment. Database rollback must use a reviewed, additive migration or a verified restore plan; never blindly restore an old database over newer production data.

## Deferred business setup

- Seller is currently operating as an individual. Keep GST and UAE VAT profiles in an unconfigured/pending state until the owner supplies verified registration details through the secure admin workflow.
- Keep payment gateways and checkout gated until merchant onboarding, credentials, delivery coverage/fees, product prices, and applicable tax details are verified.
- Never put provider secrets, passwords, OTPs, or database URLs into source control or chat.
