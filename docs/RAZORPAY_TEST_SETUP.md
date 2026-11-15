# Razorpay India test checkout setup

## Safety state

- This change adds the India Razorpay hosted checkout flow, server-side payment verification, and a signed webhook endpoint.
- It does not enable Razorpay or activate either market checkout.
- Keep `INDIA_CHECKOUT_VERIFIED` unset/false until the end-to-end test and tax, pricing, and delivery checks are complete.
- Use Razorpay Test Mode credentials only. Never put secret values in source control or chat.

## Vercel environment

The app reads these exact variable names:

| Variable | Purpose |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay Test Mode Key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay Test Mode Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Secret chosen when creating the Razorpay webhook |
| `RAZORPAY_ENABLED` | Explicit gateway enablement switch |
| `PUBLIC_BASE_URL` | HTTPS storefront base URL |

Add or change secrets only in Vercel Project Settings → Environment Variables. Use Sensitive values and the intended environment. Do not use live-mode keys for this test.

## Razorpay webhook

Create a webhook in the Razorpay Dashboard while in Test Mode:

- URL: `https://bf-shoes.vercel.app/api/v1/store/payments/razorpay/webhook`
- Event: `payment.captured`
- Copy the webhook secret into Vercel as `RAZORPAY_WEBHOOK_SECRET`.

The webhook secret is separate from the API Key Secret. A webhook signature is checked against the exact raw request body.

## Checkout API

1. Storefront creates an INR order server-side at `POST /api/v1/store/orders/razorpay`.
2. Razorpay Checkout.js opens using the returned public Key ID, order ID, amount, and INR currency.
3. The browser sends the checkout response to `POST /api/v1/store/payments/razorpay/verify`.
4. The server checks the HMAC signature and independently fetches the payment from Razorpay. Only a captured payment with the matching order, amount, and currency can mark an order paid.
5. The signed webhook provides asynchronous reconciliation. Duplicate callbacks/webhooks are handled idempotently.

The server reserves stock for 20 minutes. Captured payments with expired or inconsistent reservations are marked for stock review rather than silently overselling.

## Activation gates

The existing checkout safety gate remains in place. India checkout still requires owner-verified INR pricing, delivery fee, an active GST profile, working Razorpay credentials, and explicit `INDIA_CHECKOUT_VERIFIED=true`. Do not set that final flag until a Test Mode payment, callback verification, webhook delivery, inventory decrement, and duplicate-event handling have all been checked.

UAE checkout is unchanged.
