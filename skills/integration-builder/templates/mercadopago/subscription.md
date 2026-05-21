# Mercado Pago — Subscription Template (PreApproval)

Recurring billing via Mercado Pago's PreApproval API. Less rich than Stripe Subscriptions but works across LATAM countries with local methods.

## Pre-requisites

- A "plan" you've created in the MP dashboard, or you can create them on the fly via `PreApprovalPlan.create()`.
- Customer-on-file requires the customer to authorize a card via MP's hosted subscription flow (no off-session-first like Stripe SetupIntent).

## Create a subscription with a pre-approval

```ts
// app/api/checkout/subscribe/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mpPreApproval } from '@/lib/payments/mercadopago';

export const runtime = 'nodejs';

interface SubscribeInput {
  planId: string;
  customerEmail: string;
  amount: number;
  currency: string; // 'MXN' | 'BRL' | 'ARS' | ...
}

export async function POST(request: Request) {
  const input = (await request.json()) as SubscribeInput;
  const idempotencyKey = randomUUID(); // Rule 4

  const preApproval = await mpPreApproval.create({
    body: {
      reason: 'Pro Plan Subscription',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months', // 'months' | 'days'
        transaction_amount: Number(input.amount.toFixed(2)),
        currency_id: input.currency,
      },
      payer_email: input.customerEmail,
      back_url: `${process.env.PUBLIC_URL}/billing/success`,
      external_reference: `sub_${input.planId}_${input.customerEmail}_${Date.now()}`,
      status: 'pending', // user authorizes via init_point
    },
    requestOptions: { idempotencyKey },
  });

  return NextResponse.json({
    url: preApproval.init_point, // user authorizes here
    pre_approval_id: preApproval.id,
  });
}
```

## Lifecycle states

A PreApproval moves through:

- `pending` — created but customer hasn't authorized yet.
- `authorized` — customer authorized; MP will charge automatically.
- `paused` — temporarily not charging (user paused).
- `cancelled` — terminated.

Each charge attempt creates a `payment` record. Listen to `payment.created` / `payment.updated` webhooks (same as one-time) AND `preapproval.updated` (subscription state changes).

## Webhook event types for subscriptions

In `app/api/webhook/mercadopago/route.ts`, extend the handler:

```ts
if (body.type === 'payment') {
  // ... existing handlePaymentUpsert
} else if (body.type === 'preapproval') {
  const sub = await mpPreApproval.get({ id: body.data.id });
  await handleSubscriptionUpsert(sub);
} else if (body.type === 'authorized_payment') {
  // A recurring charge succeeded — links to the preapproval
  const payment = await mpPayment.get({ id: body.data.id });
  await handlePaymentUpsert(payment);
}
```

## Pause / cancel subscription

```ts
// Pause (continues membership but stops billing)
await mpPreApproval.update({
  id: subId,
  body: { status: 'paused' },
});

// Cancel permanently
await mpPreApproval.update({
  id: subId,
  body: { status: 'cancelled' },
});
```

## Limitations vs Stripe Subscriptions

| Feature | Stripe | Mercado Pago |
|---|---|---|
| Proration on plan change | Yes | Limited — usually recreate the subscription |
| Customer portal | Yes (hosted) | No — build your own |
| Smart Retries (dunning) | Yes (configurable) | Default retry only |
| Multiple plans per subscription | Yes | One plan per pre-approval |
| Trial periods | Yes (native) | Implementable via `start_date` |
| Tax / VAT | Stripe Tax | Merchant handles |

For SaaS with sophisticated billing (proration, plan switches, customer portal), Stripe is the better recommendation. MP wins when the seller needs LATAM-local methods (Pix, OXXO) for a simple monthly subscription.

## Anti-patterns

- ❌ Trusting `transaction_amount` from the client. Look up the plan server-side.
- ❌ Skipping `external_reference` — without it, reconciling subscriptions to your DB users is painful.
- ❌ Creating a new PreApproval to "change the plan" without cancelling the old one — you'll double-charge.
- ❌ Polling `mpPreApproval.get(id)` to wait for `authorized`. Use the `preapproval.updated` webhook.
- ❌ Building dunning logic without checking what MP already retries.

## Security rules cited

- Rule 4: `randomUUID()` on idempotency key.
- Rule 11: payer_email is the only PII passed to MP.
