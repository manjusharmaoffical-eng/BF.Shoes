# BF SHOES checkpoint — 2026-11-18 automation run 2

## Production deployment verification
- Current Vercel production deployment: `dpl_73BxRQDKe1R31La4a2csjzKU3ezN`, READY, commit `39a20874410a9b0063d14efaed0ca78ae889e4f6`, branch `work/enable-shopping-cart-pending-checkout`.
- Production aliases verified on that deployment: `www.bfshoes.online`, `bfshoes.online`, `bf-shoes.vercel.app`.
- Live `/`, `/health`, `/admin`, `/admin.html`, and `/collections.html` return HTTP 200.
- Production `/cart.html`, `/checkout.html`, and `/kids.html` currently return HTTP 404. These pages exist and return HTTP 200 on preview deployment `dpl_4Lbs3CfjbUpnM1qUUpE9gfV48KpT` (commit `3a66999541fc575cee22b3f88eb864d6ba27d762`). Preview `/admin.html` returns 200; short `/admin` is 404 on that preview branch.
- Production Vercel build log: 225 tests passed, 0 failed. Preview build log for `dpl_4Lbs3CfjbUpnM1qUUpE9gfV48KpT`: 230 tests passed, 0 failed.
- Production runtime errors: none in the latest 24-hour window; no error logs in the latest 50-minute window.

## Historical failed production-target deployment
- `dpl_ENBMixsEqurxqCTT3gbJy18Nench` is an old immutable ERROR record. Its `BUILD_UTILS_SPAWN_1` wrapper was caused by `test/schema-contract.test.js:175` still expecting the removed literal `const indiaCheckoutEnabled = false`; the actual source had moved to the dynamic market-verification gate.
- Later code removed that obsolete assertion. Current production deployment `dpl_73Bx...` is READY and its build passed 225 tests. Do not redeploy the stale failed commit.

## Verified code change
- Feature branch: `fix/india-gst-profile-status-guard-20261118`.
- Commit: `9260df905fd4919ef7981fd5cb78d1624309a7a5`.
- Files changed:
  - `src/india-market-policy.js`: added `resolveIndiaGstStatus`, which reports `registered` only when a complete INR GST profile with registration number, seller state and valid tax rate exists.
  - `src/storefront.js`: public India config now derives `gst_status` and `gst_rate_bps` from the verified profile; an env label alone no longer reports a completed GST registration.
  - `test/india-market.test.js`: tests registered/unregistered/unconfigured and incomplete/valid profiles.
  - `test/schema-contract.test.js`: asserts the public config uses the verification helper.
- GitHub Actions run `44259616775` completed successfully: 232 tests passed, 0 failed; JavaScript syntax checks passed.
- No database, tax-profile records, product prices, stock, orders, customer records, gateway credentials or production settings were changed.

## Preview infrastructure status
- Vercel preview deployment `dpl_CCBUkdPKPt5N4NJzQy9o5xKhGrbK` and one retry `dpl_F698UXispVAX1NUA7LDxoXztcGmT` both ended with `BUILD_FAILED: Resource provisioning failed` before usable build logs were available.
- GitHub Actions independently verified the exact code commit. This is a Vercel preview infrastructure blocker, not a test failure. No production deployment was made for this change.

## Market safeguards observed on production
- India: INR / PayU selected; delivery fee configured as ₹55 for PIN 500052; pricing not verified; GST tax profile not configured; payment credentials and owner verification missing; checkout and COD disabled.
- UAE: AED / PayTabs selected; pricing, delivery fee, VAT profile and payment configuration not verified; checkout and COD disabled.
- Production `/api/v1/store/config` currently reports `gst_status: registered` but `gst_rate_bps: null` and `valid_in_gst_profile_required`. The feature-branch fix changes this public status to `unconfigured` until the actual profile is valid.
- Production product API currently returns 17 India products; all are marked price-pending and stock-unverified. Do not enable sales or invent prices, stock, delivery or product photos.

## Next specific task
1. Fast-forward the existing preview branch `work/catalog-expansion-watches-eyewear` to the tested GST-status fix, then retry/verify a preview build and confirm `/api/v1/store/config` reports `gst_status: unconfigured` while no valid profile exists.
2. Review the full preview-vs-production diff and the additive migrations. Do not merge/deploy to production until the production database identity and backup/restore path are verified and owner-authenticated admin E2E checks are possible.
