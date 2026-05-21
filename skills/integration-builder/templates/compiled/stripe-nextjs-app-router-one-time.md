# Compiled — Stripe × Next.js App Router × One-time

Pre-composed reference for the highest-traffic combo. integration-specialist uses this directly when the spec matches; for other combos, it composes at runtime from per-provider + per-stack templates.

**Spec match:**
- provider: `stripe`
- stack: `nextjs-app-router`
- billing_mode: `one_time`
- frontend_style: `hosted` (Stripe Checkout redirect)

**Composes:** `stripe/reference.md` + `stripe/one-time.md` + `stripe/webhook.md` + `stripe/frontend-hosted.md` + `_stack-adapters/nextjs-app-router.md` + `_db-adapters/<orm>.md`.

---

## Files generated

```
lib/payments/stripe.ts                       # SDK init, pinned apiVersion
lib/payments/errors.ts                       # cross-provider error mapper
app/api/checkout/route.ts                    # POST — create Checkout Session
app/api/webhook/stripe/route.ts              # POST — verify signature, dispatch events
app/api/refund/route.ts                      # POST — auth-checked refund
app/checkout/success/page.tsx                # generic thank-you (NOT source of truth)
app/checkout/cancel/page.tsx
components/CheckoutButton.tsx                # client component
prisma/schema.prisma                         # 5 PagoKit tables extended (or your ORM equivalent)
.env.example                                 # test-key placeholders
PAGOKIT_INTEGRATION.md                       # audit trail
PAGOKIT_PRODUCTION_CHECKLIST.md
```

## `lib/payments/stripe.ts`

```ts
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set. See .env.example.');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil',
  typescript: true,
});
```

## `.env.example`

```
# Test mode only — Rule 8
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
PUBLIC_URL=http://localhost:3000
```

## `app/api/checkout/route.ts`

```ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { productId, quantity = 1 } = await request.json();

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: product.currency,
              product_data: { name: product.name },
              unit_amount: toStripeAmount(product.price, product.currency),
            },
            quantity,
          },
        ],
        success_url: `${process.env.PUBLIC_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.PUBLIC_URL}/checkout/cancel`,
        metadata: { product_id: product.id },
      },
      { idempotencyKey }
    );
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[checkout] failed', { code: err.code ?? 'unknown' });
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}

function toStripeAmount(amount: number, currency: string): number {
  const zero = ['JPY', 'KRW', 'HUF', 'CLP', 'VND'];
  return zero.includes(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}
```

## `app/api/webhook/stripe/route.ts`

```ts
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';

export const runtime = 'nodejs'; // Rule 5

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) return new NextResponse(null, { status: 413 }); // Rule 10

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new NextResponse(null, { status: 400 });

  const rawBody = await request.text(); // Rule 5

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent( // Rule 3 + Rule 9 (timestamp window)
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    await db.pagokitWebhookEventProcessed.create({ // Rule 9: dedup
      data: {
        event_id: event.id,
        provider: 'stripe',
        event_type: event.type,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log('[stripe.webhook]', { id: event.id, type: event.type, created: event.created }); // Rule 6

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        // notify the user; mark order as failed
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case 'charge.dispute.created':
        // alert ops, prepare evidence
        break;
      default:
        console.log('[stripe.webhook] unhandled', event.type);
    }
  } catch (err: any) {
    console.error('[stripe.webhook] handler error', { id: event.id, code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentSucceeded(pi: Stripe.PaymentIntent) {
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: pi.id },
    create: {
      provider: 'stripe',
      provider_payment_id: pi.id,
      amount: pi.amount,
      currency: pi.currency,
      status: 'succeeded',
      metadata: { product_id: pi.metadata?.product_id ?? null },
    },
    update: { status: 'succeeded' },
  });
  // Grant entitlements based on metadata.product_id
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  await db.pagokitPayment.update({
    where: { provider_payment_id: charge.payment_intent as string },
    data: { status: 'refunded' },
  });
}
```

## `components/CheckoutButton.tsx`

```tsx
'use client';

import { useState } from 'react';

export function CheckoutButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) throw new Error('No se pudo iniciar el checkout.');
      const { url } = await res.json();
      window.location.href = url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={loading} aria-busy={loading}>
        {loading ? 'Procesando…' : 'Comprar'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

## `app/checkout/success/page.tsx` + cancel

```tsx
// success
export default function SuccessPage() {
  return <main><h1>¡Gracias!</h1><p>Recibirás un correo con tu compra.</p></main>;
}
```

```tsx
// cancel
export default function CancelPage() {
  return <main><h1>Compra cancelada</h1></main>;
}
```

## Refund endpoint

See `stripe/refund-endpoint.md` for the full code. The compiled version drops in `app/api/refund/route.ts` verbatim.

## Install commands

```bash
npm install stripe@^17
npx prisma migrate dev --name pagokit_init
```

## Production checklist (key items — full file in PAGOKIT_PRODUCTION_CHECKLIST.md)

1. Generate live keys in Stripe dashboard.
2. `vercel env add STRIPE_SECRET_KEY production` (paste `sk_live_…`).
3. Add a webhook endpoint in live dashboard → copy `whsec_…` → `vercel env add STRIPE_WEBHOOK_SECRET production`.
4. Subscribe webhook to events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`.
5. Test with a real $1 charge.

## Anti-patterns (carry-over from sources)

- ❌ `await request.json()` in webhook — breaks signature.
- ❌ Trusting `amount` from the client body.
- ❌ Granting access on the success page; wait for the webhook.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12. Every rule is exercised in this compiled file.
