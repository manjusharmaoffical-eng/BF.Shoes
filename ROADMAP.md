# BF SHOES — Approved Website Completion Roadmap

Last updated: 2026-11-12

This roadmap records the owner's current direction: finish the website and all non-tax, non-payment features now. India GST registration details and payment-gateway activation will be completed only after the owner travels to India and verifies the GST number. Checkout must remain safely disabled until the owner verifies the required commercial settings.

## Hard constraints

- Do not change or reinterpret existing product selling prices.
- Do not invent purchase costs, stock quantities, warehouse locations/addresses, delivery charges, tax rates, legal identity, customer records, or order records.
- Never request passwords, OTPs, API secrets, or payment credentials in chat. Use secure provider environment-variable settings.
- Keep existing UAE/India market and currency separation. Do not mix AED and INR in finance or reporting.
- Do not activate checkout or change payment/tax configuration as part of this roadmap.
- Test each feature and review its migration before production. Preserve existing records and use additive, reversible changes where practical.

## Deferred by owner — leave untouched for now

- India GST number verification and GST profile.
- UAE VAT profile and tax setup.
- Payment gateways, including Paytm / Razorpay / PayU / PayTabs merchant onboarding or credential configuration.
- Checkout activation, payment callbacks, and live order/payment testing.

These items are intentionally deferred until the owner is in India, verifies the GST number, and gives a fresh instruction. Existing checkout safeguards must remain in place.

## Existing implemented modules — still require appropriate end-to-end verification

- Product catalogue, product editor, size variants and bulk variant entry.
- Product photo gallery and Cloudinary upload integration.
- AI Product Studio for descriptions and image generation with BF SHOES white/red/black palette.
- Warehouse stock ledger and order stock allocation/restore logic.
- Actual product unit-cost editor and finance / P&L calculations.
- Staff roles and least-privilege permissions, audit/activity log, analytics, campaigns and Ultron monitoring.
- Customer accounts, order tracking, newsletter subscription and email outbox foundations.
- Invoices/tax module code exists, but tax setup remains deferred and must not be activated.

## Remaining website completion scope

### P0 — Operational reliability and end-to-end validation
- Secure admin login, owner/manager/staff permission matrix, password change and session-expiry checks.
- Test product create/edit, bulk variants, gallery upload, AI draft generation and explicit approval/save flow using real owner-supplied product data.
- Test warehouse allocation, stock movement and cancellation restoration using a test warehouse and test stock only; do not create fake live warehouse data.
- Test finance reports with verified actual costs only; clearly show missing-cost and incomplete-data warnings.
- Verify API validation, rate limits, idempotency, overselling protection, audit trail, error handling and mobile/accessibility behavior.
- Add regression tests for all discovered defects and confirm production health/runtime logs after release.

### P1 — Storefront and customer experience
- Complete catalogue search, category/color filters, sorting and product detail presentation without breaking existing search.
- Complete wishlist persistence and customer account order history.
- Complete order tracking UX and clear order-status notifications.
- Build customer return/exchange request workflow with admin eligibility review, status history and customer updates. Do not issue refunds or charge return fees until the owner approves a verified policy and payment process.
- Improve delivery, returns, privacy and terms pages using only owner-confirmed policy details; retain clear placeholders where details are not verified.
- Complete mobile, tablet, desktop, keyboard and screen-reader checks.

### P1 — Customer communications and retention
- Complete reliable queued email delivery for order confirmations and newsletter welcome messages.
- Add customer order-status notifications and unsubscribe/consent controls.
- Add abandoned-cart recovery only with clear customer consent and verified email delivery.
- Connect coupon and campaign records to safe storefront presentation; never invent discounts or advertising spend.
- Add email delivery status, retry handling, suppression and admin visibility. Provider secrets remain server-side.

### P1 — Management and reporting
- Complete staff-management UI and verify owner-only actions.
- Complete sales, inventory, product and campaign analytics with clear distinctions between revenue and profit.
- Reconcile refunds, returns, operating expenses, COGS and ad spend in finance only when source records are real and verified.
- Add exportable reports (CSV) with currency/date filters and audit trail.

### P2 — Platform operations
- Database backup and restore runbook, scheduled backup verification and restore drills.
- Migration inventory, schema drift checks and deployment rollback procedure.
- Monitoring for API, database, email queue, AI provider and media storage failures.
- Document environment variables and provider setup without exposing secret values.
- VPS/own-server deployment guide and portability review; production remains on the currently configured hosting until the owner chooses otherwise.

## Definition of done

A feature is complete only when code is merged, migrations are safely applied if needed, automated tests pass, production deployment is READY, and the relevant live flow is verified without changing real business data. If a step requires the owner to provide a verified fact, real product image, purchase cost, warehouse details, account login or legal detail, record it as an owner input rather than fabricating it.
