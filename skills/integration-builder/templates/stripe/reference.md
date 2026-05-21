# Stripe — Reference

The canonical patterns and anti-patterns for every Stripe integration PagoKit generates. Cited by webhook.md, one-time.md, subscription.md, save-card.md, customer-portal.md, refund-endpoint.md, errors.md, and the frontend templates.

## SDK initialization (always pin API version)

```ts
// lib/payments/stripe.ts
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set. See .env.example.');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil', // Rule: pin explicitly so SDK upgrades don't break
  typescript: true,
});
```

The `apiVersion` value must match `providers.json.api_version`. Update both atomically when bumping.

## Required env vars

| Variable | Format | Where to find it |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` | Dashboard → Developers → API keys |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` or `pk_live_…` | Same screen |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Dashboard → Developers → Webhooks → click the endpoint → "Signing secret" |

Document all three in `.env.example` with test prefixes only (Rule 8).

## Recommended API flow: Payment Intents

PagoKit uses **Payment Intents** (the modern Stripe flow) — not the legacy Charges API. Payment Intents:
- Handle 3DS / SCA authentication transparently.
- Support `automatic_payment_methods` to enable the right methods per region.
- Are required for SCA-mandatory regions (EU, UK).

```ts
const intent = await stripe.paymentIntents.create({
  amount: 2000, // $20.00 in cents
  currency: 'usd',
  automatic_payment_methods: { enabled: true },
  metadata: { order_id: order.id },
}, {
  idempotencyKey: randomUUID(), // Rule 4
});
```

## Amount conventions

Stripe expects amounts in the smallest currency unit:
- USD, EUR, GBP, CAD, AUD: cents (multiply user-facing amount by 100).
- JPY, KRW, HUF: no decimals (use the integer as-is).
- See https://stripe.com/docs/currencies#zero-decimal for the full list.

```ts
function toStripeAmount(amount: number, currency: string): number {
  const zeroDecimal = ['JPY', 'KRW', 'HUF', 'CLP', 'VND', /* ... */];
  return zeroDecimal.includes(currency.toUpperCase())
    ? Math.round(amount)
    : Math.round(amount * 100);
}
```

## Webhook endpoint URL convention

`POST /api/webhook/stripe`. The handler verifies `Stripe-Signature` using the webhook secret. See [`webhook.md`](./webhook.md).

## Test cards

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |
| Insufficient funds | `4000 0000 0000 9995` |
| Requires 3DS authentication | `4000 0025 0000 3155` |

Use exp `12 / 34`, any 3-digit CVC, any zip code. Full list at https://stripe.com/docs/testing.

## Anti-patterns

- ❌ Using `stripe.charges.create(...)` — legacy Charges API; fails for EU buyers requiring SCA. Always Payment Intents.
- ❌ Initializing `new Stripe(...)` inside a request handler. Memoize at module scope.
- ❌ Hardcoding amounts in dollars (`amount: 20`) instead of cents (`amount: 2000`).
- ❌ Trusting the client to send `amount` — always look up the price server-side from your DB.
- ❌ Forgetting `apiVersion` — your code will silently behave differently when the SDK bumps.
- ❌ Mixing test and live keys (e.g., test secret + live publishable). Stripe rejects with `key_mode_mismatch`.
- ❌ Exposing the secret key to the browser. Only `STRIPE_PUBLISHABLE_KEY` is safe client-side.

## Security rules cited

- Rule 1: keys via `process.env`.
- Rule 3: webhooks always verify `Stripe-Signature`.
- Rule 4: `randomUUID()` for `idempotencyKey`.
- Rule 12: never persist PAN/CVV — Stripe handles tokenization.

## References

- Stripe API docs: https://stripe.com/docs
- Payment Intents quickstart: https://stripe.com/docs/payments/payment-intents
- Webhook signatures: https://stripe.com/docs/webhooks/signatures
- Stripe Node SDK changelog: https://github.com/stripe/stripe-node/releases
