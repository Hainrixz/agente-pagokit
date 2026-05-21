# Compiled — Stripe × Next.js App Router × Subscription

Pre-composed reference for SaaS subscription on Next.js App Router. Same security guarantees as the one-time combo, plus customer portal + recurring webhook lifecycle.

**Spec match:**
- provider: `stripe`
- stack: `nextjs-app-router`
- billing_mode: `subscription`
- frontend_style: `hosted` (Stripe Checkout for subscription signup)

**Composes:** `stripe/reference.md` + `stripe/subscription.md` + `stripe/webhook.md` + `stripe/customer-portal.md` + `stripe/refund-endpoint.md` + `stripe/frontend-hosted.md` + `_stack-adapters/nextjs-app-router.md` + `_db-adapters/<orm>.md`.

---

## Files generated

```
lib/payments/stripe.ts
lib/payments/errors.ts
app/api/checkout/subscribe/route.ts        # POST — create subscription Checkout Session
app/api/portal/route.ts                    # POST — billingPortal.sessions.create
app/api/refund/route.ts                    # POST — auth-checked refund
app/api/webhook/stripe/route.ts            # POST — verify + dispatch (includes sub events)
app/billing/success/page.tsx
app/billing/cancel/page.tsx
components/SubscribeButton.tsx
components/ManageBillingButton.tsx
prisma/schema.prisma                       # 5 PagoKit tables
.env.example
PAGOKIT_INTEGRATION.md
PAGOKIT_PRODUCTION_CHECKLIST.md
```

## `.env.example`

```
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PRO_PRICE_ID=price_REPLACE_ME       # the Stripe Price for your plan
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
PUBLIC_URL=http://localhost:3000
```

## `app/api/checkout/subscribe/route.ts`

```ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) return new NextResponse(null, { status: 401 });

  const { priceId } = await request.json();
  const idempotencyKey = randomUUID(); // Rule 4

  // Reuse or create the Stripe customer
  let customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: session.user.email },
  });
  if (!customer) {
    const stripeCustomer = await stripe.customers.create({
      email: session.user.email,
      metadata: { user_id: session.user.id },
    });
    customer = await db.pagokitCustomer.create({
      data: {
        provider: 'stripe',
        provider_customer_id: stripeCustomer.id,
        email: session.user.email,
      },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customer.provider_customer_id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.PUBLIC_URL}/billing/success`,
      cancel_url: `${process.env.PUBLIC_URL}/billing/cancel`,
      allow_promotion_codes: true,
    },
    { idempotencyKey }
  );

  return NextResponse.json({ url: checkoutSession.url });
}
```

## `app/api/portal/route.ts`

```ts
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) return new NextResponse(null, { status: 401 });

  const customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: session.user.email },
  });
  if (!customer) return NextResponse.json({ error: 'no_customer_record' }, { status: 404 });

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customer.provider_customer_id,
    return_url: `${process.env.PUBLIC_URL}/account`,
  });

  return NextResponse.json({ url: portalSession.url });
}
```

## `app/api/webhook/stripe/route.ts` — subscription events added

```ts
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) return new NextResponse(null, { status: 413 });

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new NextResponse(null, { status: 400 });

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    await db.pagokitWebhookEventProcessed.create({
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

  console.log('[stripe.webhook]', { id: event.id, type: event.type, created: event.created });

  try {
    switch (event.type) {
      // One-time payment events
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'charge.refunded':
      case 'charge.dispute.created':
        await handlePaymentEvent(event);
        break;

      // Subscription lifecycle
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_succeeded':
        // Renewal succeeded — sub period extends automatically via the subscription.updated event
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

async function handlePaymentEvent(event: Stripe.Event) { /* upsert payment row, same as one-time compiled */ }

async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
  // Resolve customer
  const customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', provider_customer_id: sub.customer as string },
  });
  if (!customer) return;

  await db.pagokitSubscription.upsert({
    where: { provider_subscription_id: sub.id },
    create: {
      provider: 'stripe',
      provider_subscription_id: sub.id,
      status: sub.status,
      customer_id: customer.id,
      plan_id: sub.items.data[0]?.price.id,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
      cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    update: {
      status: sub.status,
      plan_id: sub.items.data[0]?.price.id,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
      cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });

  if (sub.status === 'active' || sub.status === 'trialing') {
    // grant entitlement to customer.id
  } else if (sub.status === 'past_due' || sub.status === 'unpaid') {
    // dunning notification
  } else if (sub.status === 'canceled') {
    // grant lasts until current_period_end
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: sub.id },
    data: { status: 'canceled', canceled_at: new Date() },
  });
  // revoke entitlement
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('[stripe.invoice_payment_failed]', {
    invoice_id: invoice.id,
    attempt: invoice.attempt_count,
  });
  // Send branded dunning email
}
```

## `components/SubscribeButton.tsx`

```tsx
'use client';

import { useState } from 'react';

export function SubscribeButton({ priceId }: { priceId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/checkout/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId }),
    });
    if (!res.ok) { setLoading(false); return; }
    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? 'Procesando…' : 'Suscribirse'}
    </button>
  );
}
```

## `components/ManageBillingButton.tsx`

```tsx
'use client';

import { useState } from 'react';

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/portal', { method: 'POST' });
    if (!res.ok) { setLoading(false); return; }
    const { url } = await res.json();
    window.location.href = url;
  }

  return <button onClick={handleClick} disabled={loading}>Administrar suscripción</button>;
}
```

## Webhook events to subscribe in Stripe dashboard

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

## Install commands

```bash
npm install stripe@^17
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ Granting entitlement on `checkout.session.completed` only. Always reconcile via `customer.subscription.updated`.
- ❌ Skipping `invoice.payment_failed` — silent churn.
- ❌ Revoking access immediately on `customer.subscription.deleted` — leave access until `current_period_end`.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12 — all applied identically to the one-time compiled file, plus subscription event coverage.
