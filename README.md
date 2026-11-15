# BF SHOES API and storefront

Express API, storefront, admin dashboard, PostgreSQL schema, inventory/order workflows, finance reports, tax invoices, AI product tools, and optional email delivery.

## Current deployment requirements

- Node.js 22+ or Docker with Compose.
- PostgreSQL reachable from the API; keep database credentials server-side.
- A strong `JWT_SECRET` (at least 32 bytes).
- A public domain and TLS reverse proxy for production. The Compose file binds the API to `127.0.0.1:3000` so it is not directly exposed to the Internet.
- Optional `OPENAI_API_KEY` for AI copy/image generation; optional Cloudinary credentials for persistent generated-image hosting; optional Resend `RESEND_API_KEY` and verified `EMAIL_FROM` for email.

## Configure a new environment

1. Copy `.env.example` to `.env` and replace every placeholder. Do not commit `.env` or share its contents.
2. Ensure `DATABASE_URL` points to the intended PostgreSQL database and that the database user has the required schema permissions.
3. Apply the schema: `npm ci` (or `npm install` if no lockfile exists), then `npm run migrate`. Back up the database before applying schema changes to a non-empty database.
4. Create the first admin only if the `admins` table is empty: set `BOOTSTRAP_ADMIN_EMAIL` and a unique `BOOTSTRAP_ADMIN_PASSWORD` (14+ characters), run `npm run bootstrap-admin`, then remove those bootstrap variables. This command intentionally refuses to create another initial admin.
5. Run `npm test`, then `npm start` for a local smoke test. Health endpoint: `GET /health`.

## Deploy with Docker Compose on a Linux VPS

1. Install Docker Engine and the Docker Compose plugin on the VPS.
2. Copy the project files to the VPS, create `.env` from `.env.example`, and set production values.
3. Back up PostgreSQL, apply `npm run migrate` from a trusted Node environment (or run it in a one-off container with the same image and environment), then start the service with `docker compose up -d --build`.
4. Check `docker compose ps`, `docker compose logs --tail=100 bf-shoes-api`, and `curl -fsS http://127.0.0.1:3000/health`.
5. Configure Nginx/Caddy to proxy HTTPS traffic to `127.0.0.1:3000`, set `ADMIN_ORIGIN` to the exact public origin, and set `TRUST_PROXY_HOPS` to match the actual trusted proxy chain. Do not expose port 3000 publicly.
6. Keep backups encrypted and off-host; test restore procedures. Rotate credentials if they were ever shared.

The Docker image copies both `src/` and `frontend/`; without the frontend assets the server cannot serve the storefront/admin pages. The image runs as the non-root `node` user and includes a health check.

## Customer accounts and sessions

- Storefront customer registration and sign-in use `customer_accounts`; passwords are stored as bcrypt hashes and passwords are never returned by the API.
- Successful registration/sign-in sets a short-lived, `HttpOnly`, `SameSite=Lax` session cookie. In production the cookie is `Secure` and scoped to `/api/v1/customer-auth`; JavaScript does not receive or persist a bearer token.
- `GET /api/v1/customer-auth/me` restores the signed-in profile after a page reload. `POST /api/v1/customer-auth/logout` revokes the database-backed session and clears the cookie. Sessions expire after two hours.
- The additive `customer_sessions` table supports server-side revocation; it does not change existing orders, products, or stock. Credential rate limiting applies to registration and login, not profile refresh or logout.

## India market configuration (important)

- Storefront is configured for INR and delivery PIN 500052 only. No other PIN is accepted.
- Existing catalog rows priced in AED are not modified or silently relabelled as INR. The catalog flags these products as requiring price conversion, and checkout stays disabled until active product prices are verified and entered in INR.
- Set `INDIA_DELIVERY_FEE_PAISE` only to the actual confirmed fee (100 paise = INR 1). Keep it blank until confirmed; zero means explicitly free delivery, not an unknown fee.
- Cash on Delivery and online payment are shown as intended choices. COD order creation is available only after market configuration is complete. Online payment stays disabled and the API rejects it until a real gateway integration, merchant credentials, and payment verification are implemented and tested.
- Set `INDIA_GST_STATUS=registered` only after confirming the seller is GST-registered and creating exactly one active `IN_GST` profile with the correct GSTIN, seller state, INR currency and legally applicable rate; use `not_registered` only when verified. The app does not invent a GST rate or tax profile.

## Feature configuration

- AI copy and image generation require `OPENAI_API_KEY`. Generated images need Cloudinary credentials to be saved persistently; without them the app can only return a preview. Review AI-generated copy and images before publishing.
- Email delivery requires a Resend API key and a verified `EMAIL_FROM` sender. Without these, notification messages are queued but not sent.
- Finance & P/L reports are scoped to INR orders, INR expenses and INR funding. AED amounts are not converted or mixed into the India report. Funding records now carry an explicit currency. Reports are estimates from recorded product costs, delivered orders, expenses, and paid interest; missing product costs mean final profit is intentionally marked incomplete. If there are no delivered INR orders, the dashboard says so instead of implying historical AED sales are INR.
- Tax invoice profiles require correct legal seller details and jurisdiction-specific rates; validate statutory compliance before issuing invoices.
- **Live India checkout remains gated off until all catalog prices are verified in INR, the actual delivery fee for PIN 500052 is configured, COD support is confirmed, and the seller GST status plus the active GST profile (real GSTIN, seller state and applicable rate) are verified.** Do not accept live orders until `/api/v1/store/config` reports `checkout_ready: true` and an end-to-end test has been completed.

## Development checks

```sh
npm test
git diff --check
````


### Online payments (India — PayU)
India's selected gateway is PayU Hosted Checkout. The server creates a transaction with a SHA-512 request hash, posts the customer to PayU's hosted payment page, validates the reverse response hash, and confirms successful transactions server-side through PayU's Verify Payment API. The transaction is protected with order idempotency and stock reservations. Do not mark an order paid from a browser redirect alone.

Keep `PAYU_ENABLED=false`, `INDIA_CHECKOUT_VERIFIED=false`, and checkout disabled until the PayU merchant account is verified, Test Key/Salt are stored in Vercel Environment Variables, and a successful test transaction plus callback/verification checks have passed. Use `PAYU_ENV=test` for testing; switch to `production` only after PayU approves the merchant account and live credentials are issued. Never put the merchant Salt in frontend code or a URL. Register these public HTTPS endpoints in the PayU dashboard when merchant access is available: callback `https://bfshoes.online/api/v1/store/payments/payu/callback` and webhook `https://bfshoes.online/api/v1/store/payments/payu/webhook`.

PayU references:
- Hosted Checkout: https://docs.payu.in/docs/prebuilt-checkout-page-integration
- Hashing and reverse-hash validation: https://docs.payu.in/docs/hashing-request-and-response
- Test integration: https://docs.payu.in/docs/test-integration
- Production checklist: https://docs.payu.in/docs/integration-checklist-merchant-hosted-checkout
