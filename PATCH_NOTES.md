# BF SHOES API patch notes

This patch is a separate working copy. The original `bf-shoes-api.zip` is not modified.

## Fixes included
1. **Role and scope enforcement:** admin sessions receive wildcard scope only for database role `admin`; staff sessions are read-only; key-management and order-status endpoints require an administrator session.
2. **Order status safety:** explicit transition policy; shipped orders cannot be cancelled; delivered/cancelled orders are terminal; cancellation inventory restoration and audit writes are transactional.
3. **Idempotency correctness:** reject overlong keys instead of truncating; fingerprint normalized order requests; reject key reuse with different request content; serialize concurrent same-key requests; return line items on successful replays.
4. **Atomic writes:** product create + audit, API-key create + audit, and API-key revoke + audit are transactions. Existing order/inventory transactions remain in place.
5. **Bootstrap/proxy hardening:** bootstrap is serialized with a PostgreSQL advisory transaction lock; proxy trust is disabled by default and configured explicitly via `TRUST_PROXY_HOPS`; malformed/oversized JSON gets 4xx responses.
6. **Automated tests:** added a `node:test` suite and `npm test` script covering role scopes, order transition rules, and request fingerprints.
7. **Packaging and docs:** migration adds `orders.request_fingerprint` for existing databases; README documents policies, tests, and own-VPS deployment.

## Verification performed
- `node --check` passed for every JavaScript source and test file.
- `npm test`: 3 tests passed.
- ZIP integrity checked after packaging.

## Not performed
- No npm dependency installation was run.
- No live PostgreSQL migration or integration test was run.
- No VPS files, services, environment variables, database, or deployment were changed.


## Storefront build
- Added a responsive premium monochrome storefront in `frontend/` with catalog filters, size selection, bag drawer, COD checkout, order confirmation, and retry-safe idempotency keys.
- Added public `GET /api/v1/store/products` and rate-limited `POST /api/v1/store/orders`; no admin secret is exposed to the browser.
- COD checkout validates customer details and SKU quantities server-side, calculates totals from the database, locks variants during order creation, and records order items, stock movements, and audit events atomically.
- Added additive schema columns for product image URLs and COD delivery details; existing rows remain valid.
- Express serves the storefront from the same origin as the API. Nothing has been deployed and no database migration was run.
