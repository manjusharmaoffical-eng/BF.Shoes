# BF SHOES checkpoint — 2026-11-19 run 3

## Deployment and failed-build resolution
- Historical failed production-target deployment: `dpl_ENBMixsEqurxqCTT3gbJy18Nench`, commit `354c94156c270aa6dee5aac3f55030b6956adb26`, error `BUILD_UTILS_SPAWN_1`. Its build log shows the actual failing assertion expected `const indiaCheckoutEnabled = false`, while the source in that commit had it set to true for owner preview. This is an old build failure, not the current production alias.
- Current production deployment: `dpl_DHga5VATrutdut3LMnvKJyzt9vKj`, READY, commit `58fa7ea2f8413b7abfa4cad8b92de1d99663e84a`, branch `work/catalog-expansion-watches-eyewear`. Its Vercel build log reports 239 tests passed and 0 failed.
- `www.bfshoes.online` currently maps to that READY deployment. The branch's PR #64 is still open and unmerged; do not assume the branch is merged to main.
- Production `/health` returns `{"status":"ok","service":"bf-shoes-api"}`.

## Live storefront verification
- Desktop browser audit at 1512×736: 25 India product cards rendered; all 26 image resources loaded; no empty/error/loading state, no console errors, no failed network requests, and no horizontal overflow.
- Mobile/tablet audit at 390×844 and 768×1024: no horizontal overflow or clipped navigation. UAE market switch showed 25/25 products and all 25 catalogue images loaded. Cart remained empty; checkout and Add to bag remained disabled. No purchase or form submission was attempted.
- The UAE switch left the trust-strip footer copy incorrectly showing India/PIN 500052. This was fixed in the feature branch below; it is not live yet because the feature preview cannot currently provision resources.

## Read-only database and market checks
- Neon project `little-rice-43748903`, primary branch `br-hidden-cake-b8hotf4j`, database `neondb`: 50 active products (25 INR, 25 AED), 294 active variants, and 0 variants marked physically stock-verified.
- Each market currently has 8 men's, 16 women's and 1 unisex product; there are 0 products labelled for kids.
- 48 of 50 active products use SVG catalogue art, 2 have no primary image, and the product gallery table has 0 saved images. These are not verified real product photographs.
- Stored selling-price fields are present, but production market configuration still reports `pricingConfigured=false` for both markets. The public API continues to withhold numeric prices pending owner verification.
- All 50 active products are missing recorded unit cost; finance/P&L and inventory valuation therefore remain incomplete.
- `tax_profiles` contains 0 active rows. India GST and UAE VAT are not configured.
- Production market config: India INR / PayU, UAE AED / PayTabs. Both report pricing=false, deliveryFee=false, taxProfile=false, payment=false, checkout=false and COD=false. No delivery fee or tax status was invented.
- Vercel environment metadata shows `INDIA_PAYMENT_GATEWAY=payu` for production. The project notes previously selected Razorpay for India, so there is a provider mismatch. No provider change was made. Sensitive environment values were not decrypted or exposed.
- The production `DATABASE_URL` environment entry exists but is secret; its exact host was not inspected, so the mapping to the Neon project is not independently proven.
- Neon automatic snapshot schedule is empty. Only one manual snapshot was listed, dated 2026-10-26; no restore drill was performed. Do not run migrations until DB identity and backup/restore are verified.

## Security and integrations
- Unauthenticated GET checks returned HTTP 401 for 9 sensitive endpoints: admin products, inventory, orders, finance summary, warehouse summary, admin returns, tax profiles, AI product images and admin session.
- Unauthenticated email outbox cron request returned HTTP 401, confirming the worker rejects unauthenticated requests. Actual email delivery was not tested.
- AI product tools are owner-authenticated and rate-limited in code. No image/text generation was run because it may spend provider credits. Sensitive OpenAI/Cloudinary values were not read.
- Authenticated owner/admin end-to-end testing remains outstanding; no owner session was used in this run.

## New implementation and tests
- Working branch: `feature/price-verification-guard`.
- Draft PR: https://github.com/manjusharmaoffical-eng/BF.Shoes/pull/66 (base `work/catalog-expansion-watches-eyewear`; not merged).
- Changed files:
  - `frontend/app.js`: added a fail-closed verified-price predicate; cart hydration, add-to-cart, product cards and product details now reject missing, non-positive, non-integer or explicitly unverified prices; MRP/discount labels are hidden until a valid selling price is verified.
  - `frontend/index.html`: added stable IDs to the delivery trust-strip copy.
  - `test/cart-persistence.test.js`, `test/schema-contract.test.js`: updated/added price-guard regression coverage.
  - `test/homepage-regressions.test.js`: added a regression test for India/UAE delivery trust-strip copy.
- Latest feature commit: `83fc48b04bbaa592f069a82226ecf17513c804ee`.
- GitHub Actions run `44482554812` completed successfully: 241 tests passed, 0 failed; dependency install and JavaScript syntax checks passed.
- Vercel preview deployments for this feature branch repeatedly fail before build logs with `BUILD_FAILED: Resource provisioning failed` (latest `dpl_8eFKsfibqNWBtVmMwGMyCYQd8Yw4`). A manual preview retry failed the same way. This is a Vercel provisioning error, not a failing test. No preview is READY and no production alias was changed for this feature branch.
- The Termux working tree was left untouched because it is on a different branch, behind the remote by 3 commits, and has uncommitted changes in `src/storefront-policies.js`, `src/storefront.js`, and `test/stock-verification.test.js`. Local `npm test`, `git diff --check`, and JavaScript syntax checks completed with exit code 0; the local test run reported 239 passed, 0 failed.

## Blockers and next specific tasks
1. Resolve Vercel preview resource provisioning so commit `83fc48b` can be built and the new price/footer changes can be browser-verified before any merge.
2. Obtain real kids product models, names, photos, size/colour variants, verified selling prices and physical stock counts; do not create fictional catalogue data.
3. Confirm the India gateway selection (current production PayU versus the previously selected Razorpay) before any provider change; configure credentials/webhooks only through secure environment settings.
4. Obtain confirmed India PIN delivery fee/coverage, GST registration/profile details, UAE delivery coverage/fee and VAT profile details; keep checkout/COD disabled until all readiness flags pass.
5. Physically count the 294 variants and record owner-confirmed unit costs for the 50 active products before enabling sale or claiming accurate P&L.
6. Confirm the exact production database identity, establish automatic snapshots/backups, and complete a restore drill before schema migration.
7. Complete authenticated owner/admin E2E and controlled email delivery tests; do not spend AI credits or send real emails without an approved test.
8. Keep PR #66 draft and do not merge/promote it while the preview deployment is unavailable.
