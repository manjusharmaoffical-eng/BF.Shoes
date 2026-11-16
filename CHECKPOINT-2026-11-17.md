# BF SHOES verification checkpoint — 2026-11-17

## Scope
Follow-up verification of production admin authentication/operations, finance/P&L, AI Product Studio, and Cloudinary image storage. No production configuration, credentials, merchant settings, prices, stock, tax profiles, or customer data were changed.

## Production deployment
- Vercel project: `bf-shoes` (`prj_VSXNrt4hNufy9NcNN1b2eaImzuxE`)
- Current production deployment observed: `dpl_GhMadknrmKe8n2YjPCuwgfB23E4R`
- State: `READY`
- Commit: `21762d8e4c71be79c1d0f54ace1188ccddf4b1ef`
- Production aliases previously returned by Vercel: `www.bfshoes.online`, `bf-shoes.vercel.app`, `bfshoes.online`
- Live `/health`: HTTP 200, `{"status":"ok","service":"bf-shoes-api"}`
- Live `/admin.html`: HTTP 200; login form present.
- Live `/admin`: HTTP 404 (use `/admin.html`).
- Production deployment build logs report `pass 130`, `fail 0`, `tests 130`.

## Public market configuration (live)
- India: INR; delivery PIN target 500052; delivery fee configured as 5500 paise (₹55); pricing not configured/verified; GST profile not configured; PayU not configured for payment acceptance; checkout disabled. Public setup blockers: valid GST profile, PayU credentials/enablement/callback, owner verification.
- UAE: AED; pricing not configured/verified; delivery fee not configured; VAT profile not configured; PayTabs payment not configured; checkout disabled.
- These safeguards remain in place. No fees, prices, tax rates, merchant status, or payment successes were invented.

## Admin / finance / AI / storage verification
- Source mounts admin APIs under `/api/v1`, Finance under `/api/v1/finance`, AI Studio under `/api/v1/ai` and `/api/v1/ai-studio`.
- Finance endpoints and AI Studio endpoints require admin authentication; unauthenticated attempts cannot validate real business data or provider operation.
- `/admin.html` is reachable, but authenticated sign-in and full operations were NOT tested. No admin password or valid session was available in this run; no credentials were reset or created.
- Finance code supports INR/AED separation, recorded expenses/funding/repayments, and flags incomplete cost coverage. Actual data accuracy, expense/funding write workflows, and report reconciliation remain UNVERIFIED.
- AI Studio source uses server-side `OPENAI_API_KEY` for copy and image concept generation; live provider request and result persistence remain UNVERIFIED.
- Product gallery/image upload code uses signed Cloudinary uploads and persistent product-image records. Production env variable names for `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` exist, but secret values are not exposed to this connection, so credential validity and a real upload cannot be confirmed. Do not claim Cloudinary is operational until an authenticated upload succeeds.
- `OPENAI_API_KEY` production env entry exists, but value/provider validity is not visible to this connection; no live generation confirmed.

## Error observations
- Vercel aggregated 7-day runtime errors included SQLSTATE `42703` (undefined column; 11 occurrences, last observed 2026-11-14) and `28P01` (database authentication; 2 occurrences, last observed 2026-11-15), plus generic `Request failed: Error` (12 occurrences, latest 2026-11-16 13:04 UTC).
- 24-hour aggregate currently shows only the generic group (4 occurrences, same last timestamp); 50-minute production error log query returned no records.
- Historical `dpl_ENBMixsEqurxqCTT3gbJy18Nench` failure was a stale test assertion expecting a fixed disabled India checkout constant while source had evolved to dynamic checkout policy. It is not the current production deployment.
- The current production build's 130 passing tests do not prove live database/provider operations.

## Access constraints
- Desktop Commander device `localhost` is OFFLINE (last seen 40h ago); local Termux workspace cannot be inspected or tested.
- Vercel protected-page fetch for authenticated API routes returned `deployment_authentication_required`; no browser session was available to exercise the owner UI.
- Vercel environment variable secret values remain opaque to this connection. No secrets were copied or exposed.

## Next exact tasks
1. Restore the authorized Desktop Commander device or provide an authenticated owner browser session to test Admin login and protected APIs without sharing passwords in chat.
2. In Vercel secure environment settings, verify (without revealing) database connection, JWT, OpenAI, and Cloudinary production values; perform read-only DB connectivity/schema check and one real Cloudinary upload/delete-or-retain test under an owner session.
3. Run finance reconciliation against actual orders, unit costs, expenses, funding, and repayments for INR and AED separately; document any missing costs before declaring P&L complete.
4. Run AI text and image generation against the configured provider; verify results, failure handling, and saved product image records.
5. Inspect and resolve remaining runtime errors (especially generic request failures); rerun tests and deploy only a verified build. Confirm production deployment ID and aliases after deployment.

## Change log
- No application code changed in this verification run.
- This checkpoint records observed state and explicit blockers only.
