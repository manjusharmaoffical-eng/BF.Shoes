# BF SHOES — Approved Website Completion Roadmap

Last updated: 2026-11-17

This roadmap records the owner's current direction: finish the website and all non-tax, non-payment features now. India GST registration details and payment-gateway activation will be completed only after the owner travels to India and verifies the GST number. Checkout must remain safely disabled until the owner verifies the required commercial settings.

## Hard constraints

- Do not change or reinterpret existing product selling prices.
- Do not invent purchase costs, stock quantities, warehouse locations/addresses, delivery charges, tax rates, legal identity, customer records, or order records.
- Never request passwords, OTPs, API secrets, or payment credentials in chat. Use secure provider environment-variable settings.
- Keep existing UAE/India market and currency separation. Do not mix AED and INR in finance or reporting.
- PayU integration is owner-approved for India; keep live checkout disabled until merchant verification, credentials, GST profile and commercial settings are verified.
- Test each feature and review its migration before production. Preserve existing records and use additive, reversible changes where practical.

## Deferred by owner — leave untouched for now

- India GST number verification and GST profile.
- UAE VAT profile and tax setup.
- PayU merchant onboarding, credentials and merchant-dashboard webhook registration.
- Checkout activation, payment callbacks, and live order/payment testing.

The owner has now selected PayU for India. Implement and test the PayU integration on a feature branch, but keep live checkout disabled until the merchant account, credentials, GST profile and commercial settings are verified. Existing checkout safeguards must remain in place.

## Existing implemented modules — still require appropriate end-to-end verification

- Product catalogue, product editor, size variants and bulk variant entry.
- Product photo gallery and Cloudinary upload integration.
- AI Product Studio for descriptions and image generation with BF SHOES white/red/black palette.
- Warehouse stock ledger and order stock allocation/restore logic.
- Actual product unit-cost editor and finance / P&L calculations.
- Staff roles and least-privilege permissions, audit/activity log, analytics, campaigns and Ultron monitoring.
- Customer accounts, order tracking, newsletter subscription and email outbox foundations.
- Invoices/tax module code exists, but tax setup remains deferred and must not be activated.

## Remaining website completion scope

### P0 — Operational reliability and end-to-end validation
- [x] Implement secure admin login, owner/manager/staff permission matrix, password change and session-expiry checks; automated role/session tests pass. Live authenticated admin E2E still requires an owner-controlled login session.
- [x] Implement product create/edit, bulk variants, signed Cloudinary gallery uploads, AI draft generation and explicit save flow; automated tests pass. Live AI/media provider calls remain gated on verified credentials and spend approval.
- [x] Warehouse allocation, stock movement and cancellation restoration have automated test coverage; live warehouse validation awaits owner-provided location and stock records.
- [x] Finance P&L, actual-cost snapshots and current inventory valuation have automated coverage; missing costs keep profit and valuation explicitly incomplete. Real purchase costs remain owner input.
- [x] API validation, rate limits, idempotency, overselling protection, audit trail and error handling have automated regression coverage. Responsive and assistive-technology visual audit remains to be completed.
- Add regression tests for all discovered defects and confirm production health/runtime logs after release.

### P1 — Storefront and customer experience
- [x] Complete catalogue search, category/color/size filters, sorting, market-specific price ranges, multi-image product detail and keyboard-accessible modal behavior.
- [x] Complete customer account order history and cross-device wishlist sync. Anonymous wishlist saves remain local; signed-in wishlist uses customer-scoped authenticated APIs with a 200-item cap.
- [x] Complete public order tracking (exact order number + checkout email, strict rate limit), signed-in order history and queued order-status notifications.
- [x] Build customer return/exchange requests, admin review, status history and customer updates. No fixed return window, refund, fee or stock mutation is invented; those remain policy/payment-owner decisions.
- [x] Publish delivery, returns, privacy and terms pages using only verified details and clear placeholders where policies are not confirmed.
- Complete mobile, tablet, desktop, keyboard and screen-reader checks.

### P1 — Customer communications and retention
- [x] Implement queued order confirmation and newsletter welcome email delivery, bounded retry handling and scheduled outbox processing. Live sending remains gated until Resend credentials and sender verification are configured.
- [x] Add queued customer order-status and return-status email notifications; newsletter unsubscribe is signed and verified. Live sending remains provider-dependent.
- Add abandoned-cart recovery only with clear customer consent and verified email delivery.
- Connect coupon and campaign records to safe storefront presentation; never invent discounts or advertising spend.
- Add email delivery status, retry handling, suppression and admin visibility. Provider secrets remain server-side.

### P1 — Management and reporting
- [x] Complete staff-management UI, owner-only create/role/activation controls, audit activity and automated authorization checks.
- [x] Complete market-separated sales, inventory and top-product analytics with a clear revenue-not-profit warning. Campaign click/conversion attribution and ad spend are not fabricated or inferred.
- Reconcile refunds, returns, operating expenses, COGS and ad spend in finance only when source records are real and verified.
- [x] Add exportable inventory and order reports (CSV) with market filters; finance P&L CSV supports currency/date filters. Owner-only exports, no-store headers and spreadsheet-formula protection are implemented.
- [x] Add owner-only API key management UI: scoped key creation, optional expiry, one-time secret display, copy and revoke; raw secrets are never listed.
- [x] Add scheduled email outbox processing with bounded retries, row locking, owner-only manual retry and customer order/return status messages. Daily Vercel Cron (Hobby-compatible) and encrypted CRON_SECRET are configured; delivery still depends on verified Resend credentials and a verified sender.

### P2 — Platform operations
- [x] Add secure `backup-db.sh`, `pg_restore` verification, private permissions, daily systemd timer and restore runbook. Actual backup/restore drill still requires the confirmed database and VPS.
- [x] Add read-only schema drift checker, schema safety regression tests and deployment rollback instructions. Local configured Neon connection reports only the wishlist table/index and gallery `view_angle` column missing; a focused additive migration is prepared but not applied. Production identity/backup still need confirmation.
- [x] Health endpoint, Ultron monitoring and owner-only email outbox visibility/retry controls are implemented. Live third-party AI/media/email health checks depend on verified provider credentials.
- [x] Document environment variables, PayU/PayTabs setup, backup and VPS operations without exposing secret values.
- [x] Prepare a Docker Compose + PostgreSQL VPS deployment guide, private network, localhost-only app binding, health checks and separate migration step. Actual server provisioning, verified data restore and DNS cutover remain pending until the owner selects a server.

## Work completed in the 2026-11-17 continuation

- [x] Merge the latest `main` work: secure PayU hosted checkout/QR handoff page, PayTabs checkout path, product photo upload and multi-angle gallery. Both market checkout paths remain disabled until owner verification; COD/direct-order bypass is removed.

- [x] Add account-synced customer wishlists with per-customer ownership, active-product validation, idempotent save/remove, serialized 200-item cap and local-only anonymous fallback. Return HTTP 503 gracefully when the target environment has not yet applied the additive migration.
- [x] Add regression checks for staff-management authorization and production migration safety; schema safety checks reject table/column drops, truncation and record deletion.

- [x] Owner-only inventory and order CSV downloads, separated by INR/AED.
- [x] Owner-only finance P&L CSV export with date and currency filters; missing-cost profit stays explicitly incomplete.
- [x] Add current inventory valuation to finance summary and CSV; inventory value is withheld whenever any stocked variant lacks an actual unit cost.
- [x] Owner-only API key management screen with least-privilege scope selection, expiry, one-time secret reveal and revocation. Integration keys cannot receive the key-administration scope.
- [x] Role-aware admin navigation and action controls: staff are read-only, managers see only their scopes, and owner-only finance, returns, API keys, staff, audit and communications sections are hidden from non-owners.
- [x] Protect actual unit costs and margins: only the owner can set/read product costs; staff, managers, customer order responses and integration API keys never receive internal cost snapshots. Cost changes are audited.
- [x] Add separate AI copy/image rate limits to control provider spend and auto-clear expired admin sessions on API 401 responses.
- [x] Make catalog size filters functional, show market-correct price-range labels, and improve product-details modal keyboard focus/escape behavior.
- [x] Prepare self-hosted Docker Compose/VPS deployment files, optional Caddy HTTPS and systemd email scheduler without moving production data or changing DNS.
- [x] Spreadsheet formula-injection protection for all CSV exports.
- [x] Vercel Cron email outbox worker with 32+ byte timing-safe CRON_SECRET authentication, bounded batch size, row locking and maximum retry count.
- [x] Customer-facing order-status and return-status email messages are queued after successful state changes; internal notes are never emailed.
- [x] Keep return/exchange fees unconfigured and non-chargeable until owner approval; remove an unsupported ₹100 fee assumption and remove unapproved return-window/packaging terms from the policy page.
- [x] Automated Vercel build/test run: 198 tests passed in the latest complete local validation (2026-11-17); npm audit reported zero vulnerabilities.


## External inputs and production gates — do not fabricate

- Focused additive migration prepared for the configured Neon database: `customer_wishlist`, its index and `product_images.view_angle`. The local connection is not confirmed as production; no migration has been applied. The connected Supabase project metadata is healthy, but its database introspection timed out.

- PayU merchant onboarding and live credentials for India; PayTabs merchant onboarding and live credentials for UAE.
- India GST registration and verified UAE VAT profile, plus owner-verified commercial prices/delivery settings.
- Resend API key and verified sender for live customer email delivery.
- Verified production database identity, successful backup and restore drill before applying migrations.
- Real product photos, purchase costs, warehouse locations/stock and final legal/contact/returns details where not already supplied.
- A production hosting arrangement approved for commercial ecommerce use before public sales are enabled.

## Definition of done

A feature is complete only when code is merged, migrations are safely applied if needed, automated tests pass, production deployment is READY, and the relevant live flow is verified without changing real business data. If a step requires the owner to provide a verified fact, real product image, purchase cost, warehouse details, account login or legal detail, record it as an owner input rather than fabricating it.

### 2026-11-17 preview verification

- [x] Feature branch pushed to GitHub and Vercel preview deployment `dpl_6nzqzY9f5g41esfHTNd289TGWzVt` reached READY. Preview homepage, `/health`, `/admin.html`, market config and India product listing returned HTTP 200.
- [x] Preview market config reports India PayU and UAE PayTabs selected, both payment/checkout readiness flags false. Public product responses do not expose `unit_cost_cents`.
- [x] Canceled the earlier preview build before it could run schema migrations. Vercel builds now require an explicit production-only `RUN_MIGRATIONS=true` gate; preview builds never migrate.
- [ ] Production deployment and database migration remain separate from preview. The local `.env.local` database schema differs from the preview API schema; do not assume it is the production database or migrate it blindly.
