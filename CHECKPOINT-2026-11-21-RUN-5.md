# BF SHOES checkpoint — 2026-11-21 run 5

## Source and PR state
- Repository: `manjusharmaoffical-eng/BF.Shoes`.
- Working branch: `feature/price-verification-guard`.
- Latest verified branch head: `2b3605e5674b00976578f56e805376e3da49a318`.
- Draft PR #66 remains OPEN, DRAFT, not merged; base branch `work/catalog-expansion-watches-eyewear` at `58fa7ea2f8413b7abfa4cad8b92de1d99663e84a`.
- PR body updated with run 5 implementation, CI and deployment status.

## Historical production build failure
- `dpl_ENBMixsEqurxqCTT3gbJy18Nench` remains historical ERROR / `BUILD_UTILS_SPAWN_1` for commit `354c94156c270aa6dee5aac3f55030b6956adb26`.
- Its original log showed a stale schema-contract assertion expecting `indiaCheckoutEnabled = false` while that source enabled owner preview. Later source corrected the contract; the failed deployment itself is immutable history.
- Current production is not that deployment. Production alias `www.bfshoes.online` maps to READY deployment `dpl_DHga5VATrutdut3LMnvKJyzt9vKj`, commit `58fa7ea2f8413b7abfa4cad8b92de1d99663e84a`. The production build log reports 239 tests passed, 0 failed.
- Custom domains `www.bfshoes.online`, `bfshoes.online` and `bf-shoes.vercel.app` are verified; apex redirects to www.
- Latest production health check previously returned `{"status":"ok","service":"bf-shoes-api"}`. No runtime errors were found in the latest 24-hour window.

## Run 5 implementation
- Added `isValidPriceCents` in `src/storefront-policies.js`: only positive safe integer cents (number or digit-only integer string) are accepted.
- `src/storefront.js`:
  - Public market readiness now requires every active product in that currency to have a positive price.
  - Public catalog marks null/zero/negative prices pending and only returns price fields when the market gate and per-product validation pass.
  - PayU, PayTabs and the disabled-by-provider-config Binance Pay order path reject selected products with invalid stored prices.
- `src/cod.js`:
  - COD readiness fails closed if any active product in the selected market has null/zero/negative stored price.
  - COD order creation validates each selected price before calculating totals or writing the order.
- `src/routes.js`: authenticated admin-created orders reject invalid stored prices before order/inventory writes.
- Regression coverage added for price helper edge cases, COD readiness with invalid products, and wiring of every order-creation path.
- CI workflows now run the exact `npm run vercel-build` command with a dummy local test DATABASE_URL; no real database connection is used. The command includes JS syntax checks and the full Node test suite, and Vercel migrations remain gated off in GitHub Actions.

## Exact changed files and commit history
- `src/storefront-policies.js` — `9add10d4f1b66d0ab48266092d08b30dbeb47f31`
- `src/storefront.js` — `582557303e4b4652cb1179b5d8b1ff8c3f75be1e`
- `src/cod.js` — `ab9d48138916cedb55d5b2d54b199df16e23926e`
- `src/routes.js` — `fe1376f1091e5d69568433ea5cd0ff0b39133833`
- `test/storefront.test.js` — `f7ab20ffbd86e2ae60ddeb8af6b9080e99ba8be5`
- `test/cod-checkout.test.js` — `b3e135cfcb3f385b242eebeb6b5078c51886dbe2`
- `test/schema-contract.test.js` — final test-pattern correction `3bd0ef5cd56db937012e4217ff0e571603aedf4e`
- `.github/workflows/ci.yml` — `c4d589e940ebe7fb03aceada5e76630cac9bdcc6`
- `.github/workflows/test.yml` — `2b3605e5674b00976578f56e805376e3da49a318`
- Earlier PR #66 commits still include the client-side strict price guard and market-aware delivery copy; see PR diff.

## Test results
- Latest branch head `2b3605e5674b00976578f56e805376e3da49a318` passed both CI workflows using the exact Vercel build command:
  - Run `44878153171`: 244 tests, 244 pass, 0 fail.
  - Run `44878153230`: 244 tests, 244 pass, 0 fail.
- Both workflows installed dependencies and completed successfully. No production DB, payment gateway, email provider or AI generation was invoked.

## Vercel preview blocker
- Latest feature-branch preview `dpl_2NBMRf4NpxSWMvnPMqsngbNWGYB8` (same head) is ERROR with `BUILD_FAILED: Resource provisioning failed`; no build events were emitted.
- Manual redeploy `dpl_EStP9c8eRWbFDxLq88KcAxAVPN7Q` failed with the same error. Several earlier preview deployments also failed before build logs.
- GitHub Actions now prove the exact application build command passes; remaining preview failure is Vercel resource provisioning, not a failed test/build step.
- Vercel team plan is Hobby. No paid build machine, plan upgrade, purchase or billing change was attempted.
- Production alias was not changed; PR remains draft and unmerged until preview browser verification.

## Remaining blockers
1. Resolve Vercel preview resource provisioning (Vercel-side project/team resource issue); do not use paid build machines or upgrade without fresh approval.
2. Once a preview is READY, browser-test the strict price guard and India/UAE delivery trust-strip copy before merging PR #66.
3. Obtain owner-confirmed prices, real product photography, Kids catalogue facts, size/colour mapping and physical counts for all 294 variants.
4. Configure actual GST/VAT tax profiles and verified delivery coverage/fees; keep checkout/COD disabled until complete.
5. Complete PayU merchant verification and PayTabs setup via secure environment variables; do not expose credentials.
6. Enter actual unit costs for 50 products before relying on P&L/inventory valuation.
7. Verify production DATABASE_URL maps to the intended Neon project without exposing its value; configure automatic backups and perform a restore drill before migrations.
8. Complete authenticated admin, orders/returns, email-delivery and AI product-tool tests. Do not spend AI credits or send real customer emails without approval.

## Live data snapshot (last verified in run 4)
- 50 active products (25 INR, 25 AED); 294 variants.
- 0 physically verified stock variants; 0 Kids products.
- 0 owner-verified market prices; 48 SVG catalogue images, 2 missing primary images, 0 saved gallery images.
- 50 products missing unit cost; 0 active GST/VAT tax profiles.
- India provider PayU; UAE provider PayTabs. Both checkouts and COD remain disabled.
- No live product, stock, price, tax, order, payment or production environment changes were made in run 5.
