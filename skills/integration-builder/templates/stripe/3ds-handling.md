# Stripe — 3DS / SCA Handling

Strong Customer Authentication (SCA) is mandatory in the EU and UK under PSD2 and increasingly elsewhere. Stripe Payment Intents handle 3DS automatically when you use `automatic_payment_methods: { enabled: true }` and Stripe Elements / Checkout on the frontend — but if you're building a custom flow OR doing off-session charges, you need the explicit state machine below.

## When you don't need this template

- Using Stripe Checkout (`mode: 'payment'` or `'subscription'`) → Stripe handles 3DS on its hosted page.
- Using Stripe Elements with `confirmPayment({ redirect: 'if_required' })` → Stripe handles 3DS via modal or redirect.

## When you need this template

- Charging a saved card off-session (subscription renewal, scheduled charges).
- Custom checkout that doesn't use Elements (e.g., mobile native app with custom UI).
- Recovering from a `requires_action` state asynchronously.

## The PaymentIntent state machine

```
created
  → requires_payment_method        (no card attached yet)
  → requires_confirmation          (card attached, not confirmed)
  → requires_action                (3DS challenge needed; client_secret used to complete)
  → processing                     (provider working)
  → succeeded                      ✅ terminal
  → canceled                       ❌ terminal
```

## Off-session charge that may trigger 3DS

```ts
// app/api/charge-saved-card/route.ts
import { stripe } from '@/lib/payments/stripe';
import { randomUUID } from 'node:crypto';

const intent = await stripe.paymentIntents.create(
  {
    amount: 1900,
    currency: 'usd',
    customer: customerId,
    payment_method: pmId,
    off_session: true,
    confirm: true,
  },
  { idempotencyKey: randomUUID() } // Rule 4
);

if (intent.status === 'requires_action') {
  // The issuer is asking for SCA. Stripe needs the customer back on-session to authenticate.
  // Save the intent and prompt the customer (email, in-app notification) to re-authenticate.
  return NextResponse.json({
    status: 'requires_action',
    intent_id: intent.id,
    client_secret: intent.client_secret,
  });
}

if (intent.status === 'succeeded') {
  // The webhook payment_intent.succeeded will arrive shortly; reconcile from there.
  return NextResponse.json({ status: 'succeeded', intent_id: intent.id });
}

// Other statuses: requires_payment_method (card failed), canceled — handle as failure
return NextResponse.json({ status: 'failed', code: intent.last_payment_error?.code }, { status: 400 });
```

## Resuming a `requires_action` intent on the client

When the customer returns to your app (perhaps from an email link), use the saved `client_secret` to surface the 3DS challenge:

```tsx
// app/billing/resume/page.tsx
'use client';

import { useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export default function ResumePage({ searchParams }: { searchParams: { intent_id?: string; cs?: string } }) {
  useEffect(() => {
    if (!searchParams.cs) return;
    (async () => {
      const stripe = await stripePromise;
      if (!stripe) return;
      const { error, paymentIntent } = await stripe.handleNextAction({
        clientSecret: searchParams.cs!,
      });
      if (error) {
        alert(error.message);
      } else if (paymentIntent?.status === 'succeeded') {
        window.location.href = '/billing/success';
      } else if (paymentIntent?.status === 'requires_payment_method') {
        // 3DS failed; user must enter a new card
        window.location.href = '/billing/update-card';
      }
    })();
  }, [searchParams.cs]);

  return <p>Autenticando con tu banco…</p>;
}
```

## Subscription off-session renewals

For subscriptions, when a renewal fails with SCA, Stripe emits `invoice.payment_failed`. The recommended pattern:

1. On `invoice.payment_failed`, check `invoice.next_payment_attempt` — Stripe will auto-retry per your Smart Retry settings.
2. Send the customer an email with a deep link to your `/billing/update-card` page (uses the customer portal or your custom Elements form).
3. After the customer confirms a working card, Stripe charges the open invoice via `payment_intent.succeeded` on the next retry.

You do NOT need to manually call `intent.handleNextAction` for subscription renewals — Stripe handles the retry automatically when the new payment method is attached.

## Anti-patterns

- ❌ Treating `requires_action` as a failure. It's an in-progress state — save the intent id and resume.
- ❌ Discarding the `client_secret` after `paymentIntents.create`. You need it for `handleNextAction` later.
- ❌ Polling `paymentIntents.retrieve` to wait for `succeeded`. Use the webhook.
- ❌ For subscriptions, manually retrying the failed invoice from your code. Let Stripe Smart Retries do it.
- ❌ Skipping `off_session: true` on saved-card charges. Without it, 3DS is more aggressive and you'll see avoidable declines.

## References

- Stripe 3DS / SCA: https://stripe.com/docs/strong-customer-authentication
- handleNextAction: https://stripe.com/docs/js/payment_intents/handle_next_action
- Smart Retries: https://stripe.com/docs/billing/subscriptions/smart-retries
