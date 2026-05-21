# Stripe — Subscription Template

Recurring billing via Stripe Subscriptions. Includes dunning, proration, plan switching, and the webhook events that keep state in sync.

## Pre-requisites

The user must have **Products** and **Prices** created in the Stripe dashboard (or via API). PagoKit can create them on first run, but typically the user already has plan definitions.

```ts
// One-time setup (or via dashboard)
const product = await stripe.products.create({ name: 'Pro Plan' });
const price = await stripe.prices.create({
  product: product.id,
  unit_amount: 1900, // $19.00 / month
  currency: 'usd',
  recurring: { interval: 'month' },
});
// Save price.id (e.g., 'price_…') to your DB.
```

## Subscription checkout — Next.js App Router (hosted)

```ts
// app/api/checkout/subscribe/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { priceId, customerEmail, userId } = await request.json();
  const idempotencyKey = randomUUID(); // Rule 4

  // Reuse or create the Stripe customer
  let customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: customerEmail },
  });
  if (!customer) {
    const stripeCustomer = await stripe.customers.create({
      email: customerEmail,
      metadata: { user_id: userId },
    });
    customer = await db.pagokitCustomer.create({
      data: {
        provider: 'stripe',
        provider_customer_id: stripeCustomer.id,
        email: customerEmail,
      },
    });
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customer.provider_customer_id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.PUBLIC_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.PUBLIC_URL}/billing/cancel`,
      // Allow promotion codes if you use them
      allow_promotion_codes: true,
    },
    { idempotencyKey }
  );

  return NextResponse.json({ url: session.url });
}
```

## Webhook handlers — minimum for subscriptions

Subscriptions add 4 critical webhook events beyond the one-time set. Implement all of them; silent failures are the #1 cause of "churn we didn't notice".

```ts
// lib/payments/handlers/stripe.ts
import Stripe from 'stripe';
import { stripe } from '../stripe';
import { db } from '../../db';

export async function handleSubscriptionCreated(sub: Stripe.Subscription) {
  await db.pagokitSubscription.upsert({
    where: { provider_subscription_id: sub.id },
    create: {
      provider: 'stripe',
      provider_subscription_id: sub.id,
      status: sub.status,
      customer_id: await resolveCustomerId(sub.customer as string),
      plan_id: sub.items.data[0]?.price.id,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
    },
    update: {
      status: sub.status,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
    },
  });
  // Grant entitlements to the user
}

export async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  // Handles plan changes, proration, status transitions (active ↔ past_due ↔ canceled)
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: sub.id },
    data: {
      status: sub.status,
      plan_id: sub.items.data[0]?.price.id,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
      cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });

  if (sub.status === 'past_due') {
    // Dunning: notify the customer their card failed; Stripe will retry per your retry rules
  }
}

export async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: sub.id },
    data: {
      status: 'canceled',
      canceled_at: new Date(),
    },
  });
  // Revoke entitlements
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // Stripe's retry rules kick in (configurable in Dashboard → Settings → Subscriptions → Manage failed payments)
  // Send your own dunning email; Stripe sends a default one but you may want branded.
  console.log('[stripe.invoice_payment_failed]', {
    invoice_id: invoice.id,
    customer: invoice.customer,
    attempt_count: invoice.attempt_count,
  });
}
```

## Plan switching (proration)

```ts
// app/api/billing/change-plan/route.ts
const sub = await stripe.subscriptions.retrieve(currentSubId);
const updated = await stripe.subscriptions.update(currentSubId, {
  items: [{
    id: sub.items.data[0].id,
    price: newPriceId,
  }],
  proration_behavior: 'create_prorations', // or 'none', 'always_invoice'
}, { idempotencyKey: randomUUID() });
```

Proration creates an invoice for the difference. The `customer.subscription.updated` webhook fires immediately.

## Cancellation modes

| Mode | API | Effect |
|---|---|---|
| Immediate | `stripe.subscriptions.cancel(id)` | Ends now, no further invoices. |
| End of period | `stripe.subscriptions.update(id, { cancel_at_period_end: true })` | Continues until `current_period_end`, then cancels. |

PagoKit recommends end-of-period for self-serve cancellation (less surprise). The customer portal handles this for you (see `customer-portal.md`).

## Subscription test scenarios

- Sandbox card that succeeds initial charge then fails renewal: `4000 0000 0000 0341` (Stripe's "fail after attach" card).
- Always-3DS card: `4000 0025 0000 3155`.

## Anti-patterns

- ❌ Granting entitlements on `checkout.session.completed` only. That event fires once; if Stripe pauses or cancels later, you won't revoke. Always reconcile on `customer.subscription.updated`.
- ❌ Storing the subscription in your DB on initial creation only. Always upsert from webhooks.
- ❌ Ignoring `invoice.payment_failed` — silent churn. At minimum, send a dunning email and mark `status: past_due`.
- ❌ Hardcoding the dunning logic in your code. Stripe's Smart Retries (Dashboard → Subscriptions → Failed payments) does most of it; you just react to the webhook.
- ❌ Skipping `proration_behavior` on plan changes — default is `create_prorations`, but be explicit so future-you knows.

## Security rules cited

- Rule 4: `randomUUID()` on every subscription mutation (idempotency).
- Rule 9: webhook dedup persists `customer.subscription.updated` events (Stripe retries on 5xx).

## References

- Subscriptions overview: https://stripe.com/docs/billing/subscriptions/overview
- Failed payment recovery: https://stripe.com/docs/billing/subscriptions/overview#failed-payments
- Customer portal: see [`customer-portal.md`](./customer-portal.md)
