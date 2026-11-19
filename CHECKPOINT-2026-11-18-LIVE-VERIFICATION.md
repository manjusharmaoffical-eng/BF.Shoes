# BF SHOES checkpoint — 2026-11-18 live verification

## Current verified deployments
- Historical failed production-target deployment `dpl_ENBMixsEqurxqCTT3gbJy18Nench` remains in Vercel history with state `ERROR`, code `BUILD_UTILS_SPAWN_1`, commit `354c94156c270aa6dee5aac3f55030b6956adb26` on `main`.
- Its build log identifies the immediate cause as a stale schema-contract test assertion expecting `const indiaCheckoutEnabled = false`. Current `main` source no longer has that assertion; the current main head is `21762d8e4c71be79c1d0f54ace1188ccddf4b1ef`. Later production-target deployments are READY, so the historical failed deployment is superseded, not a current failed build requiring promotion.
- Latest inspected preview: `dpl_B98AoZAzX5dHoebvxiU1y4Uz3La5`, READY, branch `work/catalog-expansion-watches-eyewear`, commit `765a3df5ec6a68292c5b1bd79d26e2edc32c0a3d`. Its Vercel build log reports 237 tests, 237 passed, 0 failed.
- Production alias `www.bfshoes.online` currently maps to READY deployment `dpl_73BxRQDKe1R31La4a2csjzKU3ezN` (commit `39a20874410a9b0063d14efaed0ca78ae889e4f6`, branch `work/enable-shopping-cart-pending-checkout`). Apex `bfshoes.online` redirects to www with 308; both custom domains are verified.
- Production `/health` returned `{"status":"ok","service":"bf-shoes-api"}`.

## Live market configuration observed from production API
- India: INR; pricingConfigured=false; deliveryFeeConfigured=true; GST profileConfigured=false; PayU paymentConfigured=false; checkoutEnabled=false; COD=false.
- UAE: AED; pricingConfigured=false; deliveryFeeConfigured=false; VAT profileConfigured=false; PayTabs paymentConfigured=false; checkoutEnabled=false; COD=false.
- Public India and UAE catalog endpoints return product records. Records are still flagged price_pending_conversion=true and stock_verified=false; variant quantities are not confirmed. Existing product image URLs include generic SVG catalog art, not verified real product photography. BF SPEED RUN has conflicting historical price copy; do not alter or represent its selling price as verified without owner confirmation.
- The admin page is served, but authenticated owner/admin end-to-end verification was not performed in this run.

## Files / commits
- No application source files changed in this run.
- This checkpoint is committed as a documentation-only file on `work/catalog-expansion-watches-eyewear`.
- Previously verified commits remain: `32e5415641d74bfe3e3dc12e9e5a89c8a4a6d4c5` and `c8c4a1f80bd9056fc78dd493c848485baee4f22b` (CI setup fixes), and preview code through `765a3df5ec6a68292c5b1bd79d26e2edc32c0a3d`.

## Blockers / next tasks
1. Resolve live storefront catalog rendering discrepancy: production page text extraction shows the initial empty-state placeholder, while the market-specific product API returns product records. Verify in a real browser session before changing code; static extraction may not execute client JavaScript.
2. Verify the production DB identity and tested backup/restore before any migration or database mutation.
3. Owner-supplied product price confirmations, physical stock counts, actual product photos, and any missing size/color mappings are needed before enabling sale inventory.
4. Complete/verify India GST and UAE VAT profiles, delivery fees, gateway merchant credentials and callback/webhook configuration through secure Vercel environment variables and owner-approved documents. Keep both checkouts and COD disabled until all safeguards pass.
5. Run authenticated admin E2E tests for product/gallery/AI tools, inventory, warehouse, orders/returns, finance/P&L, email and staff/API security.
6. Do not promote preview or change production aliases until the above database and owner checks pass.


## Follow-up verification after checkpoint commit
- Checkpoint commit `c4e8708965843fa17f24ad51bd1682adf356a299` has its own Vercel preview deployment `dpl_7xvrqDMkY4MseAHByKzFH5FWvdKa`, now READY. Its build reports 237 tests passed, 0 failed.
- GitHub Actions on the exact checkpoint head `c4e8708965843fa17f24ad51bd1682adf356a299`: three workflow runs completed successfully (`44271211629`, `44271211621`, `44271202781`). The preceding commit `f6b2ab31a714d7c0c028644eb9a6bb8ebcd28267` had a test-only failure in the admin funding selector assertion; the current head's assertion now matches the rendered string and CI passes. No production release action was taken.
- PR #64 remains open and unmerged. The PR includes extensive operational changes and the documented production database/backup gate remains in force.
