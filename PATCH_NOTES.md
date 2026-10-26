# BF SHOES API patch notes

This patch is a separate working copy. The original project branch and production deployment are not modified.

## Existing project safeguards
- Preserve the existing storefront, admin API, schema, and workflows; prefer additive changes.
- Work on branch `fix/india-only-cod-500052` and verify via preview before considering production.
- Do not migrate or modify the live database as part of code review.

## Confirmed India-only business requirements
- Destination: India only.
- Payment: Cash on Delivery (COD) only.
- Delivery allowlist: PIN code `500052` only.
- Delivery fee: ₹50 per order, represented as 5,000 paise.
- Eligible return fee: ₹100, represented as 10,000 paise; customer pays after return eligibility is reviewed.
- Currency: INR only across storefront checkout, orders, invoices, and finance reports.
- Catalog: new products only.
- AI: product description generation and product-image generation/editing, with explicit admin approval before saving to a product.
- Hosting: Vercel; custom domain can be connected later.

## Implementation plan and acceptance tests

### P0 — Checkout and pricing
1. Change checkout validation to accept India only; remove UAE country/phone/currency UI paths.
2. Enforce six-digit PIN format and exact allowlist `500052` server-side; reject every other PIN.
3. Price catalog items and COD orders in INR only. Store monetary values as integer paise.
4. Add ₹50 delivery fee to the payable order total without mislabelling product subtotal. Persist a separate delivery-fee amount and total, and return them in order confirmation/tracking.
5. Keep idempotency and inventory decrement in the same database transaction. Retry with the same key must not create another order or charge another fee.
6. Disable checkout until INR prices and the order total schema are safely configured; never reinterpret existing AED values as INR.

Acceptance tests:
- India-only checkout succeeds for a configured in-stock product and PIN 500052.
- Reject UAE, missing/invalid PIN, PINs other than 500052, mixed currency, inactive SKU, and insufficient stock.
- Assert ₹50 delivery fee is added exactly once and order total = product subtotal + delivery fee.
- Assert COD is the only accepted payment method.
- Assert same idempotency key + same payload replays the original order; changed payload is rejected.
- Concurrent requests cannot oversell stock.

### P0 — Return fee policy
1. Assess return eligibility before charging a fee; do not add the return fee to initial checkout.
2. Eligible India return: ₹100 fee payable by the customer.
3. Ineligible return: no return fee.
4. Keep return fee in integer paise and label it INR.
5. Before production, define and test how defective, damaged, or incorrect-item returns are handled and disclose the policy to customers.

Unit tests added:
- Eligible return yields 10,000 paise and customer as payer.
- Ineligible return yields zero fee.
- Eligibility must be explicitly reviewed.
- Non-India return processing is rejected.

### P1 — Finance and tax
- Change finance expenses and reports from AED-only to INR-only.
- Ensure revenue, cost of goods, expenses, funding, repayments, refunds, delivery fees, and return fees are accounted for consistently without mixing currencies.
- Verify GST invoice settings with the business's actual registration and tax configuration; do not invent a tax rate.
- Test profit/loss math, missing-cost warnings, refunds, and return-fee accounting.

### P1 — Catalog and storefront
- Fix category and color filters so they do not overwrite free-text search.
- Remove UAE currency, country, phone examples, and UAE-specific AI audience defaults.
- Test mobile, tablet, desktop, keyboard navigation, empty results, and cart/checkout states.

### P1 — AI and production safety
- Verify AI provider credentials exist only in Vercel server-side environment variables.
- Verify generated images persist in approved storage and can be associated with a product.
- AI changes remain drafts until an administrator approves them.
- Test provider errors, missing credentials, upload failures, and unauthorized access.

### P2 — Deployment and verification
- Run the full test suite and static checks on the feature branch.
- Use only preview environment/database for integration tests.
- Confirm required Vercel environment variables, database connectivity, storage, AI provider, logs, and health endpoint.
- Complete a preview smoke test and visual QA before proposing production release.
- No production deployment, live migration, or live database modification without explicit approval.

## Verification status
- A separate branch was created and the return-fee policy helper plus unit tests were committed there.
- The new return-policy tests have not yet been run in this environment.
- India checkout, ₹50 delivery fee integration, INR finance, AI storage verification, visual QA, and end-to-end database tests are not yet complete.
- No live database migration or production deployment has been performed.
