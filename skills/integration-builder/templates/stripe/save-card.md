# Stripe — Save Card on File Template

Generates the SetupIntent flow for keeping a card on file without an immediate charge — useful for trials, future one-click purchases, and saving payment methods before subscription start.

## SetupIntent vs PaymentIntent

| Use case | API |
|---|---|
| Charge now | `paymentIntents.create({ amount, ... })` |
| Save card for later (no charge now) | `setupIntents.create({ customer, payment_method_types })` |
| Charge later off-session | `paymentIntents.create({ amount, customer, payment_method, off_session: true, confirm: true })` |

SetupIntent triggers 3DS authentication exactly like a PaymentIntent would, so subsequent off-session charges don't require re-auth.

## SetupIntent endpoint — Next.js App Router

```ts
// app/api/cards/save/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return new NextResponse(null, { status: 401 });

  // Find or create the Stripe customer
  let customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: session.user.email! },
  });
  if (!customer) {
    const stripeCustomer = await stripe.customers.create({
      email: session.user.email!,
      metadata: { user_id: session.user.id },
    });
    customer = await db.pagokitCustomer.create({
      data: {
        provider: 'stripe',
        provider_customer_id: stripeCustomer.id,
        email: session.user.email!,
      },
    });
  }

  const idempotencyKey = randomUUID(); // Rule 4

  const setupIntent = await stripe.setupIntents.create(
    {
      customer: customer.provider_customer_id,
      automatic_payment_methods: { enabled: true },
      usage: 'off_session', // signal SCA that future charges may be unattended
    },
    { idempotencyKey }
  );

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
```

## Frontend (Stripe Elements with confirmSetup)

```tsx
// components/SaveCardForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function InnerForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/billing/cards`,
      },
    });

    if (error) {
      setError(error.message ?? 'Algo falló.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button disabled={!stripe || submitting} type="submit">
        Guardar tarjeta
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function SaveCardForm() {
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cards/save', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => setClientSecret(data.clientSecret));
  }, []);

  if (!clientSecret) return <div>Cargando…</div>;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
      <InnerForm />
    </Elements>
  );
}
```

## Charging the saved card later

```ts
// app/api/charge-saved-card/route.ts
const paymentMethods = await stripe.paymentMethods.list({
  customer: customerId,
  type: 'card',
});

const chosenPm = paymentMethods.data[0]; // pick the user's default

const intent = await stripe.paymentIntents.create(
  {
    amount: 1900,
    currency: 'usd',
    customer: customerId,
    payment_method: chosenPm.id,
    off_session: true,
    confirm: true,
  },
  { idempotencyKey: randomUUID() } // Rule 4
);

// If SCA is required, intent.status === 'requires_action' and the user
// must re-authenticate via the saved PaymentIntent client_secret.
```

## Anti-patterns

- ❌ Storing card details server-side. Only store `payment_method.id` (e.g., `pm_…`) — let Stripe vault the PAN. (Rule 12)
- ❌ Using `usage: 'on_session'` for off-session future charges — SCA will reject the future charge.
- ❌ Charging the saved card without `off_session: true, confirm: true` for a flow that's not user-initiated.
- ❌ Forgetting to handle `requires_action` on off-session charges — silent failures.

## Security rules cited

- Rule 4: idempotency on SetupIntent + future charges.
- Rule 12: only payment method IDs in your DB, never PAN.
