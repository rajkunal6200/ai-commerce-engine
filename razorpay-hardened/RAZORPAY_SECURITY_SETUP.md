# Razorpay payment verification setup

## Backend environment

Set these variables in the backend `.env` file:

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Never put `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` in frontend JavaScript.

## Files

Replace the project's:

- `main_production_full.py`
- `payment.py`
- `app.js`

with the hardened versions supplied with this package.

## New API endpoints

- `POST /payment/verify` — server-side Checkout signature + amount + order + capture verification.
- `POST /webhooks/razorpay` — signed webhook receiver with duplicate-event protection.

## Razorpay Dashboard

Configure a webhook pointing to:

`https://YOUR_PUBLIC_HOST/webhooks/razorpay`

Subscribe to at least:

- `payment.captured`
- `payment.failed`
- `order.paid`

For local-only testing, the Checkout handler can verify payments immediately; webhooks require a publicly reachable HTTPS endpoint.
