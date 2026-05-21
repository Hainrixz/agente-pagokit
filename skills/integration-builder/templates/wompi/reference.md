# Wompi — Reference

Canonical patterns for every Wompi integration PagoKit generates. Wompi is the Bancolombia-owned gateway for Colombia (COP only): cards, PSE, Nequi, Bancolombia Button/Transfer, and cash vouchers (Efecty, Baloto, Su Red). Tokenization is client-side via Wompi's Widget; your backend never sees PAN.

## Architecture summary

- **Frontend**: Wompi Widget collects card data, generates a `transaction.id` via the Widget, redirects user to confirmation URL.
- **Backend**: Receives webhook `transaction.updated` with the final state.
- **No native subscriptions**: For recurring billing, save the card token + run your own scheduler.

## SDK initialization

Wompi doesn't ship an official Node SDK; integrate via raw HTTPS calls or the community `@wompi/wompi` package.

```ts
// lib/payments/wompi.ts
if (!process.env.WOMPI_PRIVATE_KEY) {
  throw new Error('WOMPI_PRIVATE_KEY is not set. See .env.example.');
}
if (!process.env.WOMPI_PUBLIC_KEY) {
  throw new Error('WOMPI_PUBLIC_KEY is not set. See .env.example.');
}

const WOMPI_API_BASE =
  process.env.WOMPI_PRIVATE_KEY.startsWith('prv_prod_')
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';

export async function wompiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${WOMPI_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${process.env.WOMPI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  return res;
}
```

## Required env vars

| Variable | Format | Where to find it |
|---|---|---|
| `WOMPI_PUBLIC_KEY` | `pub_test_…` or `pub_prod_…` | Dashboard → Configuración → Llaves API |
| `WOMPI_PRIVATE_KEY` | `prv_test_…` or `prv_prod_…` | Same screen — **server-only, NEVER browser** |
| `WOMPI_EVENTS_SECRET` | random string | Dashboard → Eventos → "Secret de eventos" |
| `WOMPI_INTEGRITY_SECRET` | random string | Dashboard → Configuración → "Secret de integridad" — used for the **Widget's** signature (not webhook) |

## Two checkout flavors

| Flow | Where the user lands |
|---|---|
| **Widget Embedded** | Modal/popup inside your page; user enters card → Wompi tokenizes → redirects in-flow |
| **Web Checkout (redirect)** | User redirects to `checkout.wompi.co`; pays; returns to your `redirect-url` |

PagoKit Phase 1 uses **Widget Embedded** as default (better UX). The "redirect" flow is documented as an option in `one-time.md`.

## The `signature.integrity` requirement (frontend)

Wompi's Widget requires you to compute a signature client-side based on `reference + amount + currency + WOMPI_INTEGRITY_SECRET`. To prevent leaking the integrity secret to the browser, **compute the signature on your backend** and pass it to the frontend:

```ts
// app/api/checkout/wompi-sign/route.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { reference, amountInCents, currency } = await request.json();

  const concatenation = `${reference}${amountInCents}${currency}${process.env.WOMPI_INTEGRITY_SECRET}`;
  const integritySignature = crypto.createHash('sha256').update(concatenation).digest('hex');

  return NextResponse.json({ integritySignature });
}
```

The frontend uses this signature when initializing the Widget.

## Amount conventions

Wompi expects amounts in **centavos** (smallest unit, just like Stripe for COP). For COP, $50,000 → `5000000`.

```ts
function toWompiCentavos(amount: number): number {
  return Math.round(amount * 100);
}
```

## Webhook endpoint URL convention

`POST /api/webhook/wompi`. See `webhook.md`.

## Refund flow (note — no separate template file)

Wompi supports refunds via `POST /transactions/{id}/void` (sandbox) and the merchant portal (production). PagoKit Phase 1 documents the void flow but doesn't auto-generate a `/api/refund` endpoint for Wompi — refunds in Colombia typically go through the portal manually for compliance and Bancolombia's settlement rules.

```ts
// Optional: programmatic void (sandbox + some prod accounts)
async function voidWompiTransaction(transactionId: string) {
  const res = await wompiFetch(`/transactions/${transactionId}/void`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('wompi_void_failed');
  }
  return res.json();
}
```

For production refunds, the standard pattern is: merchant initiates from the Wompi dashboard, the `transaction.updated` webhook fires with the new status, your handler updates the DB row to `refunded`.

## Test cards (sandbox)

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Decline | `4111 1111 1111 1112` |
| Pending (3DS-like) | `4509 9535 6623 3704` |

Use exp `12/29`, CVV `123`. Sandbox: https://sandbox.wompi.co

## Anti-patterns

- ❌ **Implementing a tokenization endpoint on your backend.** Wompi tokenizes client-side via the Widget. Your backend never receives raw card data. (Rule 12, listed explicitly in `providers.json.wompi.anti_patterns`.)
- ❌ Exposing `WOMPI_PRIVATE_KEY` to the browser. Only the public key.
- ❌ Forgetting to register the redirect URL in the dashboard — Wompi rejects unregistered URLs.
- ❌ Setting `currency` to anything other than `COP` for COL accounts (Wompi rejects).
- ❌ Treating "pending" cash-voucher transactions as failed. Cash vouchers (Efecty, Baloto, Su Red) take up to 72 hours.

## Security rules cited

- Rule 1: keys via `process.env`.
- Rule 3: webhook checksum verification (see `webhook.md`).
- Rule 4: server-generated UUID for `reference` (acts as idempotency token).
- Rule 12: Widget tokenizes client-side; no PAN on your server.

## References

- API docs: https://docs.wompi.co
- Widget integration: https://docs.wompi.co/docs/colombia/widget-checkout-web
- Eventos: https://docs.wompi.co/docs/colombia/eventos
