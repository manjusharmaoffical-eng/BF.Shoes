# BF SHOES checkpoint — 2026-11-23 Run 8

## State inspected
- Repository: `manjusharmaoffical-eng/BF.Shoes`, default branch `main`.
- Main head before this checkpoint: `a49b8b38bd7c66bf354319ae78f30d4d04d42d10` (currency-safe India GST / UAE VAT reports).
- Latest production deployment before this checkpoint: `dpl_91TCiJmPiDVpCYJVsRKhBfmsQEyW`, target=production, state=READY, commit `a49b8b38bd7c66bf354319ae78f30d4d04d42d10`, region `bom1`.
- Production aliases on that deployment: `www.bfshoes.online`, `bfshoes.online` (redirects to www), `bf-shoes.vercel.app`, and Vercel main aliases.

## Historical production-target build failure
- `dpl_ENBMixsEqurxqCTT3gbJy18Nench` is an old immutable ERROR deployment on commit `354c94156c270aa6dee5aac3f55030b6956adb26`; it cannot be changed to READY.
- Its `BUILD_UTILS_SPAWN_1` wrapper was caused by `npm run vercel-build` exiting 1 on a stale assertion in `test/schema-contract.test.js:175`: the test expected `const indiaCheckoutEnabled = false` while that commit's source exposed the India checkout UI for owner testing behind server-side gates.
- The later main test contract no longer contains that stale assertion. The superseding production deployment on commit `a49b8b3` is READY and its Vercel build log reports 261 tests passed, 0 failed. Do not retry or promote the historical failed SHA.

## Preview provisioning after Neon branch cleanup
- The explicitly approved archived branch `mcp-migration-2026-11-03T10-30-36` (`br-still-bar-b8t5jx12`) was deleted in the preceding conversation.
- After cleanup, Git-generated preview deployments succeeded:
  - `dpl_JFdq6Hbt92NnG6YqZmSxpQ4MPnto` READY, branch `ops/verify-vercel-auto-preview-20261122`, commit `79dc8b7618e535a7e2854d1a45e623753cf8f748`.
  - `dpl_BQPxU7MDLTKVt4YK7Wc9ZCTDkBEp` READY, same branch, commit `12d19d0d9b1eb8d9c39005ead8594a8fa0041e3c`; build log reports 244 tests passed, 0 failed.
- Neon now has 10/10 branches again because Vercel created preview branches. The archived `backup/bf-speed-run-variants-20261028` branch remains preserved. Do not delete another branch without fresh explicit approval.

## Production verification performed
- Read-only browser QA:
  - Homepage `https://www.bfshoes.online/`: HTTP 200.
  - `/health`: HTTP 200.
  - `/api/v1/store/market-config`: HTTP 200.
  - `/api/v1/store/products?market=IN`: HTTP 200, 25 products.
  - `/api/v1/store/products?market=AE`: HTTP 200, 25 products.
  - `/admin` and `/admin.html`: HTTP 200, sign-in page displayed.
  - Apex `https://bfshoes.online/` redirects to `https://www.bfshoes.online/`.
  - No console errors, uncaught errors, failed fetches, or network-failure events observed. Earlier 390px check reported no horizontal overflow.
- Anonymous security smoke test: unauthenticated GETs to `/api/v1/auth/me`, `/api/v1/products`, `/api/v1/inventory`, `/api/v1/orders`, `/api/v1/admin/api-keys`, `/api/v1/finance/summary`, `/api/v1/invoices/report`, and `/api/v1/warehouse` all returned 401 JSON. No credentials or write methods were used. This is not a substitute for the live read-only-key 403 or stale-admin-token 401 tests.
- Main production Vercel build: 261/261 tests passed. GitHub Actions run `45083086005` for main commit `a49b8b3` completed successfully; Vercel commit status is success.

## Business safeguards and remaining blockers
- India is configured for INR / PayU; UAE for AED / PayTabs. Public market config still reports checkout/payment/pricing readiness disabled.
- All 25 products in each market remain price-unverified; product UI says price verification pending and stock check pending. Do not invent or publish prices.
- Delivery fees/coverage, active GST/VAT profiles and merchant readiness are not verified. Checkout and COD remain closed. No payment, tax, price, stock, order or customer records were changed.
- Prior linked-Neon snapshot: 294 active variants, none physically verified; 50 products missing actual unit costs; no active tax profiles. Treat counts as linked Neon main snapshot, not independently proven production-database identity.
- Genuine product photos and verified unit costs are still needed; do not substitute generated product images for actual item photography.
- Independent encrypted off-device backup and restore drill remain incomplete. Cloudflare R2 was previously unavailable on the current plan; do not upgrade or copy customer data to another provider without an approved secure destination.
- Real production API-key write-denial 403 and old-admin-token 401 tests still need safe approved test credentials. Do not read, expose or request secrets in chat.
- AI image generation and real email delivery were not run; do not spend credits or send real customer messages without approval.
- Historical PostgreSQL `42P08` error cluster: 4 occurrences, last seen 2026-11-21T22:22:47Z on `dpl_78eUg8tkmGc3SQLkbcXe5jgSSgHn`. Current last-30-minute production runtime-log query returned no error/fatal logs. Hobby retention prevented retrieval of the historical request trace, so no speculative SQL edit was made.

## Exact changes in this run
- No application source files changed.
- This file is a documentation-only checkpoint. The preceding source commits remain `f5fc3c3b8e7e9de260ba6fa616cb4f4d35d0827b` and `a49b8b38bd7c66bf354319ae78f30d4d04d42d10`; latest production source is unchanged by this checkpoint.

## Next specific task
- Verify the Vercel deployment triggered by this documentation-only checkpoint commit, ensuring the production alias remains READY.
- Then continue the pending authenticated security tests only with safe test credentials; investigate PostgreSQL 42P08 only if a fresh request trace or reproducible failure is available. Keep all market checkout gates closed until owner-supplied prices, delivery, tax and merchant verification are complete.
