# BF SHOES — self-hosted VPS deployment

This is a prepared deployment path for a Linux VPS. It does not change DNS, copy production data, or activate checkout. Do not run it against production until the owner has selected a server and approved the migration window.

**Hosting compliance note:** the connected Vercel account currently reports the Hobby plan. Vercel states that Hobby is for personal or non-commercial use; a revenue-generating BF SHOES store needs an eligible commercial hosting arrangement or a migration to a suitable VPS before commercial operation. No paid plan was purchased and no DNS cutover was performed. See [Vercel Terms](https://vercel.com/legal/terms).

## Requirements

- Ubuntu 24.04 LTS (or another supported Linux distribution), 2 vCPU / 4 GB RAM recommended for the application and a small PostgreSQL instance.
- Docker Engine and the Docker Compose plugin.
- A domain whose DNS can be pointed to the VPS, plus HTTPS via Caddy or another reverse proxy.
- A separate encrypted off-server backup destination.

## Prepare secrets on the VPS

1. Clone the approved BF SHOES repository into a private directory.
2. Create a private `.env` file beside `compose.yaml`; set permissions to `600`.
3. Set `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. Use a random hexadecimal password so it is URL-safe in `DATABASE_URL`.
4. Generate separate random values for `JWT_SECRET` and `CRON_SECRET` (at least 48 random bytes each). Never reuse the same value.
5. Set `ADMIN_ORIGIN` to the exact HTTPS storefront origin. Do not use `*`.
6. Add AI, Cloudinary and Resend variables only when those providers are actually configured. Keep checkout disabled until merchant and tax requirements are verified.

Example secret generation on the VPS (prints values only in that private terminal):

```sh
openssl rand -hex 48
```

Never paste the generated values into ChatGPT or commit `.env`.

## First boot (new empty VPS database only)

```sh
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose up -d app
docker compose ps
docker compose logs --tail=100 app
```

The application binds to `127.0.0.1:3000` on the VPS and is also reachable by Caddy over the private Docker network. Do not expose PostgreSQL or port 3000 directly to the public internet. The included `Caddyfile` serves `bfshoes.online` and `www.bfshoes.online` with automatic HTTPS. Start the optional proxy only after the owner approves DNS cutover and both DNS records point to the VPS:

```sh
docker compose --profile tls up -d caddy
```

Allow inbound TCP 80/443 (and UDP 443 for HTTP/3) in the VPS firewall.

## Existing production database migration

Do not start a new empty database and assume it contains the production data. Before any migration:

1. Create and verify a production database backup using `scripts/backup-db.sh`.
2. Restore the dump into a separate VPS database and run the application against that restored copy.
3. Verify schema, product counts, variants, inventory, orders, return requests, admin access and market configuration.
4. Agree on a write-free migration window, take one final backup, and only then plan DNS cutover.
5. Keep the previous deployment and database intact until the new host has passed the agreed live checks.

## Operations

- Run `docker compose ps` and `docker compose logs --tail=100 app` for service health.
- Use `docker compose restart app` only after a reviewed configuration change.
- Backups must be copied to separate encrypted storage; the Docker volume alone is not a backup.
- Test restore into a disposable database before relying on a backup.
- The Vercel cron schedule is not used by this Compose setup. Schedule `GET /api/cron/email-outbox` from a trusted external scheduler with `Authorization: Bearer $CRON_SECRET`; never expose the secret in logs or URLs.

## Cutover gate

Do not change DNS or production hosting until the owner has chosen the VPS provider/server and approved the migration. Payment gateway, GST/VAT, checkout and all unverified commercial settings remain gated.

## Self-hosted email queue schedule

For a VPS, use the included systemd service and timer instead of Vercel Cron:

1. Install `curl`, create the dedicated service account (`sudo useradd --system --home-dir /opt/bf-shoes --shell /usr/sbin/nologin bfshoes`), and create `/opt/bf-shoes/scripts/` owned by `bfshoes:bfshoes`. Copy `scripts/run-email-outbox.sh` there with mode `700`.
2. Create `/etc/bf-shoes/bf-shoes.env` with `BF_SHOES_BASE_URL=https://www.bfshoes.online` and the same `CRON_SECRET` used by the application. Set owner `root:bfshoes` and mode `640`.
3. Copy both files from `deploy/systemd/` to `/etc/systemd/system/`.
4. Run `systemctl daemon-reload`, then `systemctl enable --now bf-shoes-email-outbox.timer`.
5. Check `systemctl list-timers bf-shoes-email-outbox.timer` and `journalctl -u bf-shoes-email-outbox.service`.

The script requires HTTPS and supplies the bearer secret through curl's standard input configuration, not the URL. The timer is optional and must not be enabled until DNS and the HTTPS endpoint are correctly configured.

## Daily database backup on a VPS

The PostgreSQL port is bound to `127.0.0.1:5432` only, so the host backup script can reach it without exposing the database publicly. Install the PostgreSQL client tools (`sudo apt install postgresql-client`) and set these protected entries in `/etc/bf-shoes/bf-shoes.env`:

```sh
DATABASE_URL=postgres://POSTGRES_USER:POSTGRES_PASSWORD@127.0.0.1:5432/POSTGRES_DB?sslmode=disable
BACKUP_DIR=/var/backups/bf-shoes
```

Use the real values in the private file, with a URL-safe random hex database password. Create `/var/backups/bf-shoes` owned by `bfshoes:bfshoes`, mode `700`. Copy `scripts/backup-db.sh` to `/opt/bf-shoes/scripts/` owned by `bfshoes:bfshoes`, mode `700`. Install `deploy/systemd/bf-shoes-db-backup.service` and `.timer` into `/etc/systemd/system/`, then run `systemctl daemon-reload` and `systemctl enable --now bf-shoes-db-backup.timer`. Check `systemctl list-timers bf-shoes-db-backup.timer` and `journalctl -u bf-shoes-db-backup.service`.

This creates a verified local backup daily. A VPS disk failure can still destroy local backups, so configure an encrypted off-server copy before treating the backup plan as complete. No off-site storage provider or credentials are assumed here.

## Hosting compliance note

The connected Vercel project is currently on the Hobby plan. Vercel states that Hobby is for personal, non-commercial use and positions Pro for businesses. BF SHOES is intended to be a commercial storefront, so do not treat Hobby as the long-term production hosting choice. Use a suitable commercial Vercel plan or deploy to a VPS. No paid upgrade or provider purchase has been made. See <https://vercel.com/pricing>.

On Vercel, preview builds never run migrations. Production migration is also gated: only set `RUN_MIGRATIONS=true` for a reviewed, backed-up production migration deployment, then remove the variable. The VPS path uses the explicit `docker compose --profile tools run --rm migrate` command above.
