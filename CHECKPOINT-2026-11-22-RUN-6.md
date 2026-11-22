# BF SHOES — Run 6 checkpoint (2026-11-22)

## Work completed
- Inspected the historical production-target failure `dpl_ENBMixsEqurxqCTT3gbJy18Nench`. Its `BUILD_UTILS_SPAWN_1` wrapper was caused by a stale assertion in `test/schema-contract.test.js:175` expecting `const indiaCheckoutEnabled = false`; the current source had already moved to the market-readiness helper. The historical deployment remains ERROR, but it is superseded by a later successful production deployment.
- Confirmed latest production deployment `dpl_5v1w4nPhRiudTB3FUxYDXPTYnrdn` is READY on `main` commit `56143ecd1597a041167a3861207cd5b25a6c9b78`. The `www.bfshoes.online` alias still points to that deployment.
- Merged latest `main` into `feature/price-verification-guard` (merge commit `a40a749adbdba383944c35a97fdeb5a4b7d50723`). Resolved the market-delivery trust-strip HTML conflict using the existing `market-delivery-title` contract and removed the duplicate updater from `frontend/app.js`.
- Added `test/auth-http-verification.test.js`: real Express HTTP requests with deterministic mocked database results verify read-only API-key GET returns 200, write POST returns 403, a pre-password-change admin token returns 401 after `session_version` increments, and the current token returns 200. These are middleware integration tests, not tests against production credentials or production DB.
- Synced the package-lock root Node engine to the declared `24.x` requirement.

## Exact branch / commits / files
- PR branch: `feature/price-verification-guard`
- Branch head at checkpoint preparation: `3c1c24bd20155536883554691a8a9d54e66747ca`
- Relevant commits: `a40a749` (merge latest main and resolve delivery-strip contract), `1ad64a6` (HTTP auth verification tests), `3c1c24b` (lockfile Node engine sync).
- Files changed in this run: `frontend/index.html`, `frontend/app.js`, `test/homepage-regressions.test.js`, new `test/auth-http-verification.test.js`, `package-lock.json`.

## Tests
- Local `npm run vercel-build` on the merged feature branch, using a disposable test-only PostgreSQL URL and no database connection/migration: **255 tests passed, 0 failed**.
- GitHub Actions for branch head `3c1c24b` completed successfully: runs `45001519002`, `45001524794`, `45001524808`.
- Latest `main` production build log: **248 tests passed, 0 failed**.
- Local Termux runtime was Node `26.3.1`; repository and Vercel project require Node `24.x`. GitHub Actions and Vercel project runtime are pinned to Node 24.

## Production verification
- `https://www.bfshoes.online/` HTTP 200; `/app.js` HTTP 200; `/health` HTTP 200; unauthenticated `/api/v1/auth/me` HTTP 401; public market-config HTTP 200.
- Production alias `www.bfshoes.online` still maps to READY deployment `dpl_5v1w4nPhRiudTB3FUxYDXPTYnrdn`. No alias or production environment setting was changed.
- Public market-config: India INR / PayU and UAE AED / PayTabs are selected, but for both markets pricing, delivery fee, tax profile and payment readiness are false; checkout and COD are disabled.
- Public catalogue API returns 25 India and 25 UAE products; none are marked `price_verified` or `stock_verified`. The API withholds unverified prices.
- The historical failed deployment is not the production alias. No production migration, order, payment, stock mutation, email send or AI generation was run.

## Preview deployment blocker
- Latest Git-generated preview for this branch (`dpl_BAPwuzpHWzBvSyK2iVj9QuSPieQA`) failed with `BUILD_FAILED: Resource provisioning failed` before emitting build events.
- A CLI prebuilt preview also failed with the same error in `bom1` (`dpl_CSsat25zzdfDhPCfUyPNxG4t4B9f`) and `iad1` (`dpl_4nZmfckKd93vgugATqvL6zdsbJS4`). The `dxb1` override was rejected as unavailable for this deployment.
- Vercel status page reported all systems operational on 2026-11-22; no global incident explains the project deployment failures. No further blind retries were made.
- An earlier READY CLI deployment `dpl_7kHDmG6ANVxu3r9TMSkke8qL6KX8` has no Git commit metadata, so it is not treated as verification of this branch.
- PR #66 remains draft and unmerged. Do not promote or merge until a preview for the current commit reaches READY and the price guard / UAE market copy are browser-verified.

## Linked Neon read-only snapshot (production URL-to-branch mapping not independently confirmed)
- 25 active INR products and 25 active AED products; no invalid stored positive-price values were found, but market-level owner pricing verification remains false.
- 294 active variants; 0 physically verified active variants and 0 physically verified in-stock variants.
- 0 active tax profiles; 50 products missing actual unit cost (25 INR, 25 AED); 3 active admin accounts. No emails, password hashes or secrets were read from the result.
- Orders 0, order items 0, returns 0, finance expenses 0, funding records 0, tax invoices 0, notification outbox rows 0; inventory movements 6 and warehouse stock movements 0.
- Because the exact Vercel production `DATABASE_URL` mapping was not read, these counts are explicitly a snapshot of the linked Neon main branch, not asserted as a proven production-database identity.

## Remaining blockers / next task
1. Resolve Vercel project-level resource provisioning so a current-commit preview can become READY; then browser-test price guard and UAE delivery copy. Keep PR #66 draft until this passes.
2. Owner verification is still needed for selling prices, delivery fees/coverage, GST/VAT registration details and merchant onboarding. Do not set readiness flags or enable checkout from assumptions.
3. Physical counts are still required for 294 variants. Actual product photos and 50 unit costs are not supplied; do not invent them.
4. Finance/P&L has no recorded orders or expenses yet and is incomplete until actual costs are recorded.
5. Verify the production DB mapping, create an independent encrypted off-device backup and complete a restore drill. No approved independent storage destination was available in this run.
6. Production API-key and pre-password-change token HTTP tests remain unperformed because no production test credentials/tokens were available; the new tests use mocked DB results. No authenticated production admin login was attempted.
7. AI generation and real email delivery were not tested; no AI credits or real customer messages were sent.
