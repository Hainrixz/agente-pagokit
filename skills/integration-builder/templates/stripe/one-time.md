# Stripe — One-time Payment Template

Creates a one-time charge via Payment Intents, with idempotency and proper amount handling. Pairs with `frontend-hosted.md` (redirects to Stripe Checkout) or `frontend-embedded.md` (Stripe Elements).

## Checkout endpoint — Next.js App Router (Checkout Sessions / hosted)

```ts
// app/api/checkout/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface CheckoutInput {
  productId: string;
  quantity?: number;
}

export async function POST(request: Request) {
  const input = (await request.json()) as CheckoutInput;

  // Always look up price server-side; never trust client-sent amounts
  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        // automatic_payment_methods would be set if creating PaymentIntent directly
        line_items: [
          {
            price_data: {
              currency: product.currency,
              product_data: { name: product.name },
              unit_amount: toStripeAmount(product.price, product.currency),
            },
            quantity: input.quantity ?? 1,
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
    // Don't leak provider error details to the client
    console.error('[checkout] failed', { code: err.code, idempotency_key: idempotencyKey });
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}

function toStripeAmount(amount: number, currency: string): number {
  const zeroDecimal = ['JPY', 'KRW', 'HUF', 'CLP', 'VND'];
  return zeroDecimal.includes(currency.toUpperCase())
    ? Math.round(amount)
    : Math.round(amount * 100);
}
```

## Checkout endpoint — Next.js App Router (PaymentIntent / embedded)

If using Stripe Elements (embedded) instead of Checkout:

```ts
// app/api/checkout/intent/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { productId, quantity = 1 } = await request.json();
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });

  const idempotencyKey = randomUUID(); // Rule 4

  const intent = await stripe.paymentIntents.create(
    {
      amount: toStripeAmount(product.price * quantity, product.currency),
      currency: product.currency,
      automatic_payment_methods: { enabled: true }, // enables 3DS / SCA automatically
      metadata: { product_id: product.id },
    },
    { idempotencyKey }
  );

  return NextResponse.json({ clientSecret: intent.client_secret });
}
```

The client then uses the `clientSecret` with Stripe Elements (see `frontend-embedded.md`).

## Express equivalent

```ts
// routes/checkout.ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { stripe } from '../lib/payments/stripe';

const router = Router();

router.post('/api/checkout', async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: 'product_not_found' });

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ /* same as above */ }],
        success_url: `${process.env.PUBLIC_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.PUBLIC_URL}/checkout/cancel`,
        metadata: { product_id: product.id },
      },
      { idempotencyKey }
    );
    res.json({ url: session.url });
  } catch (err: any) {
    console.error('[checkout] failed', { code: err.code });
    res.status(500).json({ error: 'checkout_failed' });
  }
});

export default router;
```

## Anti-patterns

- ❌ Trusting `amount` from the request body. Look it up from your DB.
- ❌ Skipping `idempotencyKey` — duplicate clicks become duplicate charges.
- ❌ Using `mode: 'payment'` for subscriptions or vice versa.
- ❌ Returning the raw Stripe error to the client. Map via `errors.md`.
- ❌ Forgetting `automatic_payment_methods` on PaymentIntent — defaults to card-only, EU buyers can't use SEPA/iDEAL.

## Security rules cited

- Rule 4: `randomUUID()` literal on the idempotency_key line.
- Rule 11: collect minimum PII (let Stripe Checkout handle billing address via `billing_address_collection`).
- Rule 12: never receive or persist PAN — Stripe Checkout / Elements tokenize on the frontend.
