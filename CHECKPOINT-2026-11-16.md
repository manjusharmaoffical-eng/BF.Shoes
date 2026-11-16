# BF SHOES project checkpoint — 2026-11-16

## Verified production baseline

- Repository: `manjusharmaoffical-eng/BF.Shoes`
- Main commit inspected: `21762d8e4c71be79c1d0f54ace1188ccddf4b1ef` — “Add secure BF SHOES website and PayU QR”.
- Current production deployment: `dpl_GhMadknrmKe8n2YjPCuwgfB23E4R`, state `READY`, target `production`; aliases include `bf-shoes.vercel.app`, `bfshoes.online`, and `www.bfshoes.online`.
- Production build applied the database schema and completed `npm test`: **130 passed, 0 failed**.
- Public read-only checks on 2026-11-16: homepage HTTP 200, BF SHOES storefront rendered with 17 styles; `/health` HTTP 200 with `{"status":"ok","service":"bf-shoes-api"}`; public India config and market config HTTP 200.
- No admin login, form submission, payment, upload, or live business-data mutation was performed.

## Historical failed deployment

- Historical deployment `dpl_ENBMixsEqurxqCTT3gbJy18Nench` remains recorded as `ERROR` with `BUILD_UTILS_SPAWN_1`.
- Its build log identifies the actual cause: `test/schema-contract.test.js:162` expected the obsolete source text `const indiaCheckoutEnabled = false`; the assertion no longer matched the guarded checkout implementation.
- The later test-contract correction is in commit `9b504d2675fe202474a6fd445186868ac3925452`. The current main production deployment subsequently passed all 130 tests. The old deployment is historical; it is not the current production alias.

## Market and checkout readiness

### India
- Public production config: INR, delivery PIN allowlist `500052`, PayU selected.
- `pricingConfigured=false`, `taxProfileConfigured=false`, `paymentConfigured=false`, `paymentQrEnabled=false`, `checkoutEnabled=false`.
- India setup blockers returned by the API: `valid_in_gst_profile_required`, `payu_credentials_not_configured`, `india_checkout_not_owner_verified`.
- GST registration status is recorded as registered, but the active GST profile/rate is absent (`gst_rate_bps=null`).
- Production delivery fee is currently `5500` paise (₹55) and marked configured. A previous saved owner-approved note recorded ₹49; this conflicts with the current production value. Do not change or activate checkout until the owner confirms which amount is correct.
- `INDIA_PRICING_VERIFIED=false` and `PAYU_ENABLED=false`; keep checkout closed.

### UAE
- AED and PayTabs are selected in production configuration.
- Public market config reports pricing, delivery fee, VAT profile, payment and checkout as not ready.
- `UAE_DELIVERY_FEE_FILS` is unset in production. A previous saved owner-approved note recorded AED 3; this conflicts with the current production environment comment that no fee is approved. Do not change or activate checkout until the owner confirms the intended fee and the VAT profile is completed.
- Keep checkout closed.

## Admin, finance and AI

- `/admin.html` returns HTTP 200 and displays the logged-out Admin sign-in page. Authenticated operations have not yet been tested.
- Admin UI contains Products, Inventory, Warehouse & Production, Orders, Returns, Finance & P/L, Invoices & Tax, AI Product Studio and Ultron sections.
- Finance routes are owner-only; INR/AED separation, integer-cent profit calculations and incomplete-profit warnings have automated coverage. Actual finance reconciliation still needs verified product costs and authenticated owner testing.
- AI Product Studio routes are owner-only. Product copy/image generation requires server-side `OPENAI_API_KEY`; persistent image uploads/saves require Cloudinary credentials. No provider status is exposed publicly and no live generation/upload was tested in this run.
- The current deployment tests include warehouse allocation/restore, finance math, mobile touch-size/header and storefront regressions.

## Security and operational notes

- No secret values were read or copied. Environment metadata and public readiness responses were used instead.
- Vercel's 24-hour error summary still contains older errors: 8 generic root-route errors (last seen 2026-11-15 20:11 UTC, deployment `dpl_9ebdAsMyXiPGBxUatB4zpKTRqBNq`) and 2 PostgreSQL `28P01` authentication errors (last seen 2026-11-15 18:55 UTC, deployment `dpl_H6xfiQVwd1E6uhxRiWPgGWapJc9e`). The current deployment's last-30-minute error-level runtime-log query returned no records; current health check is 200.
- The repository currently tracks a `node_modules/` tree (1,767 entries, about 7.28 MB) and `.gitignore` does not exclude it. No removal was made because untracking the existing dependency tree is a destructive repository change requiring approval.
- Vercel runtime-log retention is limited on the current Hobby plan; older individual request logs could not be retrieved beyond the retained window.

## Exact files reviewed

- `README.md`, `ROADMAP.md`, `PATCH_NOTES.md`, `package.json`, `.gitignore`
- `src/storefront.js`, `src/ai-studio.js`, `src/finance.js`, `src/server.js`
- `frontend/admin.html`, `frontend/admin.js`
- Historical failing test: `test/schema-contract.test.js`

## Next specific task

1. Keep all checkout gates closed.
2. Reconcile the conflicting saved-vs-production delivery fee values for India and UAE before changing any environment variables.
3. After the owner signs in manually, verify admin role permissions, product CRUD/bulk variants, photo gallery, stock adjustment, warehouse allocation and cancellation restoration using test-only data.
4. Verify finance reports using only real owner-entered costs; then test AI copy/image generation and Cloudinary persistence if the server-side providers are configured.
5. Re-run the full build/test suite and verify the production alias after any code change.
