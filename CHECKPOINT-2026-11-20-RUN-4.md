# BF SHOES checkpoint — 2026-11-20 run 4

## Scope and source state
- Inspected the previous durable checkpoint `CHECKPOINT-2026-11-19-RUN-3.md`, PR #66, the feature branch, current Vercel deployment history, production alias, public market APIs and live browser behavior.
- Feature branch: `feature/price-verification-guard`.
- Before this checkpoint commit, feature branch head was `bb3ebf46b9fc6435955a1d6f437d485710788dbf`.
- PR #66 remains OPEN, DRAFT, mergeable, base `work/catalog-expansion-watches-eyewear`; do not merge or promote until preview verification is possible.

## Historical production-target failure diagnosis
- Deployment `dpl_ENBMixsEqurxqCTT3gbJy18Nench` is still historically `ERROR` with `BUILD_UTILS_SPAWN_1`; its build command was `npm run vercel-build`.
- Retrieved build events identify the precise failure: stale assertion in `test/schema-contract.test.js:175` expected `/const indiaCheckoutEnabled = false/`, but the source in commit `354c94156c270aa6dee5aac3f55030b6956adb26` set `indiaCheckoutEnabled = true` for owner preview. The test assertion was inconsistent with the source.
- Later main commit `21762d8e4c71be79c1d0f54ace1188ccddf4b1ef` has the corrected market-config contract and has a later READY production-target Vercel deployment `dpl_9BCkUuURgEosQp4mdtjRuJLFjUFY`. The old deployment record itself is immutable history; it was superseded, not retroactively changed.
- Current production alias is separate: `www.bfshoes.online` maps to READY deployment `dpl_DHga5VATrutdut3LMnvKJyzt9vKj`, commit `58fa7ea2f8413b7abfa4cad8b92de1d99663e84a`, branch `work/catalog-expansion-watches-eyewear`. Its Vercel build log reports 239 tests, 239 pass, 0 fail. Health endpoint returned `{"status":"ok","service":"bf-shoes-api"}`.

## Current production browser and API verification
- Read-only browser check on `https://www.bfshoes.online/`: desktop 1440×900 rendered 25 product cards; mobile 390×844 rendered 25 cards; all 25 product images loaded after lazy-load scrolling; no console errors, unhandled rejections, resource-load errors or horizontal overflow.
- UAE market selection rendered 25 products but the live delivery trust strip still incorrectly showed `INDIA DELIVERY` and `PIN 500052 · Delivery fee pending confirmation`. The market-aware copy fix is on the feature branch only and is not live.
- Current production market config:
  - India: INR, PayU; pricing=false, delivery fee=false, GST profile=false, payment=false, checkout=false, COD=false.
  - UAE: AED, PayTabs; pricing=false, delivery fee=false, VAT profile=false, payment=false, checkout=false, COD=false.
- Public catalog API aggregates:
  - India: 25 products, 149 variants; 0 products with `price_verified=true`; 25 price-pending; 0 stock-verified variants; 0 kids; 24 SVG primary images, 1 missing primary image.
  - UAE: 25 products, 145 variants; 0 products with `price_verified=true`; 25 price-pending; 0 stock-verified variants; 0 kids; 24 SVG primary images, 1 missing primary image.
  - Total: 50 products, 294 variants, 0 verified prices, 0 physically verified variants, 0 kids, 48 SVG catalogue images, 2 missing primary images, no verified real product photography.
- No cart additions, checkout submission, order creation, payment, admin login, DB writes or account setting changes were performed.

## New code change and verification
- On `feature/price-verification-guard`:
  - Commit `5df86e67102714cc8d71e743eac122018743d6d2`: `frontend/app.js` now requires the explicit backend flag `price_verified === true` before product prices can display or products can enter cart/detail purchase flows. A missing verification flag no longer passes.
  - Commit `bb3ebf46b9fc6435955a1d6f437d485710788dbf`: `test/schema-contract.test.js` asserts the explicit verified-flag requirement.
- GitHub Actions for head `bb3ebf46b9fc6435955a1d6f437d485710788dbf` completed successfully:
  - run `44691467366`: 241 tests, 241 pass, 0 fail; JavaScript syntax check passed.
  - run `44691467282`: 241 tests, 241 pass, 0 fail; dependency and QR package checks passed.
  - Non-blocking Node warning: deprecated `url.parse()` usage from a dependency.
- The feature-branch Vercel preview remains blocked by platform provisioning:
  - Automatic deployments `dpl_BU4qdu2c5BSWoRJBuxhP6ZYUeQDt` and `dpl_nsfXNrZbLr3Af5uoQokQb2FF3wu5` failed with `BUILD_FAILED: Resource provisioning failed`, before build logs.
  - One manual preview retry `dpl_GpqWSW8n4pDxMwFRETne2UvpnaEC` also failed with the same resource-provisioning error and no build events. This is not a failing application test.
  - No custom build machine, paid service, production alias change or retry with a potentially paid configuration was attempted.
- No application/database changes were made outside the feature branch; no secrets were decrypted or exposed.

## Remaining blockers and next specific tasks
1. Resolve Vercel preview resource provisioning (platform support/account quota/temporary resource issue) so PR #66 can be browser-verified; do not merge or promote while the preview is unavailable.
2. Verify the market-aware delivery trust-strip fix in a preview: current live UAE selector still displays India/PIN copy.
3. Confirm the India payment provider: current production config is PayU, while previous owner instructions selected Razorpay. Do not change provider without confirmation. Keep both markets' checkout/COD disabled.
4. Obtain owner-confirmed prices, four-angle product photos, kids catalogue details, size/colour mappings and physical stock counts for the 294 variants. Do not invent them.
5. Obtain verified India delivery fee/coverage and GST profile, UAE delivery fee/coverage and VAT profile; keep checkout disabled until every readiness gate is satisfied.
6. Record owner-confirmed unit costs for all 50 products before finance/P&L can be complete.
7. Confirm production DATABASE_URL maps to the intended Neon project without exposing its value; configure automatic backups and complete a restore drill before migrations.
8. Complete authenticated admin end-to-end tests, email delivery tests, and AI tool verification only when approved credentials/test targets are available. Do not spend AI credits or send real customer emails without approval.
