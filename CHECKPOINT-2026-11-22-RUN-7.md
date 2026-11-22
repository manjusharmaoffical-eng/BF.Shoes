# BF SHOES checkpoint — 2026-11-22 Run 7

## What was inspected
- Re-read `CHECKPOINT-2026-11-22-RUN-6.md` from `feature/price-verification-guard`.
- Vercel team `BF SHOES OFFICIAL` is on the Hobby plan; Git project `bf-shoes` is linked to `manjusharmaoffical-eng/BF.Shoes`.
- Latest production deployment remains `dpl_5v1w4nPhRiudTB3FUxYDXPTYnrdn`, READY, target=production, main commit `56143ecd1597a041167a3861207cd5b25a6c9b78`, region `bom1`.
- Deployment metadata explicitly lists aliases `www.bfshoes.online`, `bfshoes.online`, `bf-shoes.vercel.app`, and Vercel deployment aliases. Project domain listing confirms `www.bfshoes.online` and `bf-shoes.vercel.app` verified; apex `bfshoes.online` verified and redirects to www with HTTP 308.
- Project's current latestDeployment metadata points to failed preview `dpl_FJsrc3D74rVTvEZnVsFE4TwrgFNg`; this does not change the production target above.
- Latest preview branch `feature/price-verification-guard` has repeated ERROR deployments, including `dpl_FJsrc3D74rVTvEZnVsFE4TwrgFNg` for commit `59678dc5373d2fd10e8026002c5a1b2abb2e59a4`. Build events are empty; Vercel failure is `BUILD_FAILED: Resource provisioning failed`.
- Historical `dpl_ENBMixsEqurxqCTT3gbJy18Nench` remains an immutable ERROR; prior checkpoint establishes its `BUILD_UTILS_SPAWN_1` was a stale schema-contract test assertion, later corrected. It is not the current production alias.
- Vercel documentation supports build machine selection via a per-commit Turbo marker / CLI option, but no evidence shows this team has access to a different build machine on Hobby. No paid upgrade or build-machine setting change was attempted.
- Project config `vercel.json` on main contains region `bom1` and cron `/api/cron/email-outbox`; no config was changed.
- Runtime error aggregation shows 4 occurrences of PostgreSQL `42P08` on route `/`, last seen 2026-11-21T22:22:47Z on deployment `dpl_78eUg8tkmGc3SQLkbcXe5jgSSgHn`. No error-level runtime logs were returned in the latest 30-minute window; Hobby log retention prevented a 1-hour query. Treat the historical 42P08 group as an investigation lead, not a confirmed current outage.
- Read-only browser verification started as run `3b7d4c95-bd9c-41ac-845f-3f2a6ff151bb`; at checkpoint time it remained running with no terminal findings. Do not claim its checks passed until the same run returns terminal output.

## Verified production code review
- Main commit `56143ecd1597a041167a3861207cd5b25a6c9b78` adds `sessionVersionMatches` and uses it in `src/auth.js`; includes auth contract tests.
- Reviewed `src/db.js`, `src/routes.js`, and `vercel.json` on main. No production code/config changes made in this run.
- Prior Run 6 checkpoint reports 255/255 feature-branch tests and production 248/248. Do not inflate those counts; this run did not execute a fresh source test suite.

## Exact changes
- No application source files changed.
- This checkpoint file only.

## Deployment status
- Production alias/domain mapping remains verified against READY deployment `dpl_5v1w4nPhRiudTB3FUxYDXPTYnrdn`; no deployment, promotion, rollback, alias, region, plan or secret changes made.
- Preview provisioning remains blocked before build logs; repeated retries are not useful without a platform-side explanation.
- No production DB migration, payment, order, stock update, email, or AI generation executed.

## Blockers
1. Vercel Hobby preview provisioning: no build events; repeated failures across prior regions; needs Vercel platform-side diagnosis or team entitlement/resource fix. Do not buy/upgrade without fresh approval.
2. Historical PostgreSQL 42P08 on homepage route: locate the exact SQL statement from runtime trace/source and fix only if reproducible.
3. Production browser verification pending completion of existing Browser Use run.
4. Production API-key and stale-admin-token HTTP tests still require a safe approved test credential/account; do not mint or expose secrets in chat.
5. Checkout stays disabled pending owner-confirmed prices, delivery fee/coverage, GST/VAT profiles, verified merchant onboarding and credentials.
6. Physical stock, genuine product photos, Kids catalogue facts and unit costs remain unprovided; no inventory/finance assumptions.

## Next specific task
- Retrieve Browser Use run `3b7d4c95-bd9c-41ac-845f-3f2a6ff151bb` to finish public production verification. Then trace the historical PostgreSQL 42P08 route error against the exact deployed source/trace before editing. In parallel, ask Vercel support/platform tooling for the preview provisioning failure without changing plan or build settings.
