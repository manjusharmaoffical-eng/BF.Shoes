# BF SHOES checkpoint — 2026-11-17 automation run

## Changes committed
Branch: `work/catalog-expansion-watches-eyewear`

- `32e5415641d74bfe3e3dc12e9e5a89c8a4a6d4c5` — `.github/workflows/test.yml`: install lockfile dependencies with `npm ci`, align Node with the project's Node 24 engine, and use a non-secret dummy DATABASE_URL for unit tests.
- `c8c4a1f80bd9056fc78dd493c848485baee4f22b` — `.github/workflows/ci.yml`: use the same isolated dummy DATABASE_URL for tests. It only initializes pg.Pool; no database server or real credentials are used.
- No application, database, payment, tax, price, stock, order, or customer data was changed.

## Verification
- Latest Vercel preview: `dpl_9QKzQdAtdWJ39fr4RxByK9VoBAKj`, READY, commit `c8c4a1f80bd9056fc78dd493c848485baee4f22b`.
- Latest Vercel build: 223 tests passed, 0 failed; JavaScript syntax checks passed.
- Both GitHub Actions workflows now pass: run `44042129924` and run `44042129860`.
- Preview home, `/health`, `/admin.html`, `/api/v1/store/products`, India config and market config return HTTP 200.
- Preview homepage no longer exposes global catalogue size/colour filters or the category-showcase image row. Product detail code includes colour and size choices, metadata/attributes, MRP, stock status, and a multi-image gallery. This is preview-only, not yet on the production alias.
- Admin preview contains the future GST/VAT profile form; no registration documents or tax rates were entered.
- The old failed deployment `dpl_ENBMixsEqurxqCTT3gbJy18Nench` failed because an obsolete test expected the removed constant `const indiaCheckoutEnabled = false`. Later code replaced that assertion with the dynamic market-readiness policy. Current main production build and latest preview pass their build tests.

## Production state — unchanged
- Current production-target deployment observed: `dpl_7JaR269FCK1s5ZQorLdVYPW2oC2c`, READY, commit `c88e1ecee57f154996c5fa8996e828df384dba33`; aliases include `www.bfshoes.online`, `bfshoes.online`, and `bf-shoes.vercel.app`.
- Live homepage and `/admin.html` return HTTP 200. Live customer pages checked (collections, men, women, sports, casual, running, sneakers, watches, eyewear, about, shipping, returns, FAQ, contact, tracking, policies, payment and payment-result) return HTTP 200.
- Production homepage still has global catalogue filters and category-showcase illustrations; production product-detail JS does not yet include the preview's colour selector and product-attribute display.
- Production product API returns 17 products; all are marked `price_pending_conversion=true` and `stock_verified=false`. The sampled product gallery endpoint returns an empty image list.
- Latest preview product API returns 25 products; all are still price-pending and stock-unverified. Sample gallery endpoint is empty. Do not invent selling prices, stock, or real product photos.

## India / UAE safeguards
- India: INR, PayU selected, GST profile unconfigured, prices unverified, owner-confirmed delivery fee ₹55 for PIN 500052, payment credentials/owner verification missing, checkout and COD disabled.
- UAE: AED, PayTabs selected, VAT profile and delivery fee unconfigured, prices/payment unverified, checkout and COD disabled.
- No gateway credentials, merchant verification, tax rates, or checkout flags were changed. GST/VAT can be completed after the owner returns with registration documents.

## Remaining blockers / next exact tasks
1. Keep the preview branch separate from production until the production database identity and a verified backup/restore path are confirmed; PR #64 remains unmerged.
2. Investigate the historical `42703` undefined-column runtime error last seen on preview deployment `dpl_4qrerayzzBXnRzt3npxjNhH3HySK` at 2026-11-17 03:43 UTC. The latest 50-minute runtime-log query returned no error records, but schema drift is not proven resolved. Do not apply the prepared additive migration until the target database is positively identified and backup/restore is verified.
3. Run authenticated owner Admin E2E checks for product upload, AI generation, finance/P&L, orders, inventory and tax-profile form. No owner session was available in this run.
4. Obtain owner-supplied product prices, physical stock, and real product photos before enabling sales or claiming product galleries are complete.
5. After the database and owner checks, re-run tests, review the full PR diff, then decide separately whether to merge/deploy. No production deployment was made in this run.
