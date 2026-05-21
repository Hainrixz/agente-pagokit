# Mercado Pago — Reference

Canonical patterns for every Mercado Pago integration PagoKit generates. MP is the LATAM default — covers AR/BR/CL/CO/MX/PE/UY with local methods (Pix, OXXO, PSE, Rapipago, PagoEfectivo, Servipag) and multi-currency settlement.

## SDK initialization (modern v2 client)

```ts
// lib/payments/mercadopago.ts
import { MercadoPagoConfig, Payment, Preference, PreApproval } from 'mercadopago';

if (!process.env.MP_ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN is not set. See .env.example.');
}

export const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: {
    timeout: 5000,
    idempotencyKey: undefined, // set per-request
  },
});

export const mpPayment = new Payment(mpClient);
export const mpPreference = new Preference(mpClient);
export const mpPreApproval = new PreApproval(mpClient); // subscriptions
```

## Required env vars

| Variable | Format | Where to find it |
|---|---|---|
| `MP_ACCESS_TOKEN` | `TEST-…` or `APP_USR-…` (long template) | Dashboard → Tus credenciales → "Production" / "Test" tab |
| `MP_PUBLIC_KEY` | `APP_USR-…` or `TEST-…` | Same screen, used on the frontend (Bricks) |
| `MP_WEBHOOK_SECRET` | Random string | Dashboard → Webhooks → Edit endpoint → "Webhook secret" |

Document all three in `.env.example` with `TEST-` prefixed values only (Rule 8).

## Two main flows

| Flow | API | When to use |
|---|---|---|
| **Checkout Pro** (hosted) | `Preference.create()` | Redirects to MP's hosted page; lowest friction. |
| **Custom checkout** (embedded) | `Payment.create()` with a card token from Bricks | Stay on your site; tokenize the card via Bricks SDK on the frontend. |
| **Suscripciones** | `PreApproval.create()` | Recurring billing with saved card. |

## Amount conventions

Mercado Pago expects amounts as `number` in the **major unit** of the currency (so $100 MXN is `100`, not `10000`). The opposite of Stripe.

```ts
function toMpAmount(amount: number, currency: string): number {
  // Most LATAM currencies have 2 decimals; some have 0 (CLP).
  // Mercado Pago accepts floats.
  return Number(amount.toFixed(2));
}
```

## Webhook endpoint URL convention

`POST /api/webhook/mercadopago`. The endpoint must be public HTTPS — MP can't deliver to localhost. Use `cloudflared` or `ngrok` in development; see `/pagokit:test`.

## Idempotency

Mercado Pago accepts an `X-Idempotency-Key` header on POST requests to `/v1/payments` and `/v1/payments/{id}/refunds`. The SDK exposes it per-call:

```ts
import { randomUUID } from 'node:crypto';

const result = await mpPayment.create({
  body: { /* ... */ },
  requestOptions: { idempotencyKey: randomUUID() }, // Rule 4
});
```

## Test cards (vary by country)

Per `providers.json.mercadopago.test_cards` — these are Mercado Pago Argentina defaults; MX, BR, CL have different test cards (see https://www.mercadopago.com/developers/en/docs/checkout-api/integration-test/test-cards).

| Scenario | Card (AR) |
|---|---|
| Success | `5031 7557 3453 0604` |
| Decline | `5031 4332 1540 6351` |
| 3DS required | `5031 7557 3453 0604` (CVV 555) |

For test users (buyer + seller) in sandbox, you must create them in the dashboard — MP doesn't ship a default test buyer like Stripe does.

## Country differences

| Country | Currency | Notable local methods | Sandbox availability |
|---|---|---|---|
| AR | ARS | Pago Fácil, Rapipago, tarjeta + cuotas | Full |
| BR | BRL | Pix (instant), Boleto Bancário | Full |
| MX | MXN | OXXO, SPEI, MSI (meses sin intereses) | Full |
| CL | CLP | Servipag, Webpay-like flows | Full |
| CO | COP | PSE, Efecty, tarjeta | Partial |
| PE | PEN | PagoEfectivo, tarjeta | Partial |
| UY | UYU | RedPagos, Abitab | Partial |

When PagoKit recommends MP, the country detected drives which methods to enable in the preference / payment.

## Anti-patterns

- ❌ Forgetting `X-Idempotency-Key` on `Payment.create()` — duplicate charges are documented as a common production issue.
- ❌ Sharing test credentials between countries — MP's sandbox is per-country. AR test buyer can't pay an MX seller.
- ❌ Storing the `MP_ACCESS_TOKEN` on the frontend. Only `MP_PUBLIC_KEY` goes to the browser.
- ❌ Polling `Payment.get(id)` to wait for `status === 'approved'`. Use the webhook (`payment.updated`).
- ❌ Hardcoding payment method IDs (`pix`, `oxxo`) without country awareness. MX has no Pix; AR has no Boleto.

## Security rules cited

- Rule 1: keys via `process.env`.
- Rule 3: webhook verifies `x-signature` (see `webhook.md`).
- Rule 4: `randomUUID()` for `idempotencyKey`.
- Rule 12: card data tokenized via Bricks on the frontend, never on your server.

## References

- API docs: https://www.mercadopago.com/developers/en
- Webhook signature: https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks
- Test cards by country: https://www.mercadopago.com/developers/en/docs/checkout-api/integration-test/test-cards
