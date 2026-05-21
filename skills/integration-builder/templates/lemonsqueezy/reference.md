# Lemon Squeezy — Reference

Canonical patterns for every Lemon Squeezy integration PagoKit generates. Lemon Squeezy is a Merchant of Record (MoR) — it sells to the buyer **on your behalf**, collects/remits VAT/sales tax/GST globally, and pays you the net. Ideal for digital goods cross-border without setting up tax entities in 50 jurisdictions.

## What "MoR" means for the integration

You don't manage tax. You don't collect billing addresses for VAT purposes. You don't issue invoices to end customers. Lemon Squeezy does all that. Your code is much simpler than a Stripe integration:

- No `automatic_tax` config.
- No customer-facing invoicing.
- No EU VAT MOSS / IOSS gymnastics.
- No `tax_id` collection.

What you DO need:

- Define products (variants, prices) in the LS dashboard.
- Open a hosted checkout (`buy.lemonsqueezy.com/...`) or embed it.
- Receive webhooks for `order_created`, `subscription_*`, refunds.
- Grant entitlements based on webhook events.

## SDK initialization

```ts
// lib/payments/lemonsqueezy.ts
import { lemonSqueezySetup, getStore, listProducts, createCheckout } from '@lemonsqueezy/lemonsqueezy.js';

if (!process.env.LEMONSQUEEZY_API_KEY) {
  throw new Error('LEMONSQUEEZY_API_KEY is not set. See .env.example.');
}

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  onError: (error) => {
    // Rule 6: log only metadata
    console.error('[lemonsqueezy] sdk error', { code: error.cause ?? 'unknown' });
  },
});

export { createCheckout, listProducts, getStore };
```

## Required env vars

| Variable | Format | Where |
|---|---|---|
| `LEMONSQUEEZY_API_KEY` | `lmnsq_test_…` or `lmnsq_live_…` (JWT-ish long string) | Dashboard → Settings → API |
| `LEMONSQUEEZY_STORE_ID` | numeric (e.g., `12345`) | Dashboard → Settings → General |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | random | Dashboard → Settings → Webhooks → click endpoint → "Signing secret" |

## Test mode

Lemon Squeezy has a "Test mode" toggle in the dashboard (top right). When ON:
- Use `lmnsq_test_*` keys.
- Checkouts use test card `4242 4242 4242 4242`.
- No real payouts.

PagoKit Phase 1 always writes `.env.example` with `lmnsq_test_…` placeholder (Rule 8).

## Checkout flow (hosted by LS)

1. User clicks "Buy" on your site.
2. Your backend calls `createCheckout()` to generate a one-time checkout URL.
3. User is redirected to `https://<store>.lemonsqueezy.com/checkout/buy/<variant>?...`.
4. User pays on LS's page.
5. LS sends `order_created` (or `subscription_created`) webhook to your endpoint.
6. Your handler grants entitlements based on the webhook.
7. User is redirected back to your `receipt_link` (success URL).

## Subscriptions

If `billing_mode == subscription`, the same `createCheckout` is used but with a variant configured as a subscription in the dashboard. Recurring billing is handled by LS:

- Initial: `subscription_created` + `order_created`.
- Renewal: `subscription_payment_success` (+ a new `order_created`).
- Failure: `subscription_payment_failed`.
- Cancel: `subscription_cancelled`.

## Refunds

LS supports refunds via API (Phase 2) or the dashboard. The webhook `subscription_payment_refunded` (or `order_refunded`) fires when a refund is issued. Phase 1 generates the webhook handler stub; the actual `/api/refund` endpoint is optional because most LS users refund from the dashboard.

## Amount conventions

LS handles amounts internally — your code doesn't pass amounts when creating a checkout. The variant in the dashboard owns the price, currency, and (for subs) interval.

## Webhook endpoint URL convention

`POST /api/webhook/lemonsqueezy`. See `webhook.md`. LS does NOT sign the timestamp, so event-id dedup is **mandatory** (Rule 9).

## Test cards

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |

Use exp `12/34`, CVV `123`.

## Anti-patterns

- ❌ Collecting tax IDs yourself. LS handles VAT/sales tax/GST. (Listed in `providers.json.lemonsqueezy.anti_patterns`.)
- ❌ Calling LS to issue an "invoice". The customer-facing invoice is LS's responsibility as MoR.
- ❌ Skipping event-id dedup. LS doesn't sign timestamps — replay attacks are possible without dedup.
- ❌ Exposing `LEMONSQUEEZY_API_KEY` to the browser. Use server-only endpoints.
- ❌ Heavy customization of checkout branding. LS allows store-level branding (logo, colors); per-checkout customization is limited.

## Security rules cited

- Rule 1: keys via `process.env`.
- Rule 3: webhook HMAC-SHA256 verification.
- Rule 9: event-id dedup (mandatory — no timestamp signature).
- Rule 12: PAN never touches your server; LS hosted checkout.

## References

- API docs: https://docs.lemonsqueezy.com/api
- SDK: https://github.com/lemonsqueezy/lemonsqueezy.js
- Webhooks: https://docs.lemonsqueezy.com/help/webhooks
- Test mode: https://docs.lemonsqueezy.com/help/test-mode
- Re: Stripe acquisition (2024): https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy
