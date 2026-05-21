# Stripe — Frontend Embedded (Elements)

Pattern when `frontend_style: embedded` is chosen. The checkout lives inside your own UI using Stripe Elements (Payment Element). More custom, more control, slightly higher PCI scope (still SAQ A — PAN never touches your server).

**When to choose this:**
- You want the checkout to feel native to your brand.
- Subscriptions with custom upsells before card entry.
- Building a custom flow Stripe Checkout can't express.

## Install

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

## Server: PaymentIntent endpoint

Already covered in [`one-time.md`](./one-time.md):

```ts
// app/api/checkout/intent/route.ts — creates a PaymentIntent and returns the clientSecret
```

## Client: Payment Element + confirm

```tsx
// components/CheckoutForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface CheckoutFormProps {
  productId: string;
  quantity?: number;
}

function InnerForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
      },
      redirect: 'if_required', // returns inline if no 3DS / SCA needed
    });

    if (error) {
      setErrorMsg(error.message ?? 'Algo falló.');
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === 'succeeded') {
      window.location.href = '/checkout/success';
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <button type="submit" disabled={!stripe || submitting} aria-busy={submitting}>
        {submitting ? 'Procesando…' : 'Pagar'}
      </button>
      {errorMsg && <p role="alert">{errorMsg}</p>}
    </form>
  );
}

export function CheckoutForm({ productId, quantity = 1 }: CheckoutFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/checkout/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('failed_to_init');
        return r.json();
      })
      .then((data) => setClientSecret(data.clientSecret))
      .catch(() => setError('No pudimos cargar el formulario de pago.'));
  }, [productId, quantity]);

  if (error) return <p role="alert">{error}</p>;
  if (!clientSecret) return <div>Cargando…</div>;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: 'stripe' },
      }}
    >
      <InnerForm />
    </Elements>
  );
}
```

## Handling 3DS / SCA

`stripe.confirmPayment({ redirect: 'if_required' })` handles 3DS transparently:

- If the issuer doesn't require 3DS → returns inline with `paymentIntent.status === 'succeeded'`.
- If 3DS is required → redirects to the issuer's challenge page, then back to `return_url`.

For embedded flows where you want to stay on-page even during 3DS, omit `redirect: 'if_required'` and Stripe handles the modal challenge in-place.

For the full 3DS state machine (handling `requires_action`, fallback to redirect), see [`3ds-handling.md`](./3ds-handling.md).

## Return URL handling

When 3DS redirects back, the `return_url` includes `?payment_intent={pi}&payment_intent_client_secret={secret}&redirect_status=succeeded` query params:

```tsx
// app/checkout/success/page.tsx
export default function SuccessPage({ searchParams }: { searchParams: any }) {
  // The webhook is the source of truth; show generic success here.
  return <p>¡Gracias por tu compra!</p>;
}
```

## Required env var on the client

```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
```

⚠️ `NEXT_PUBLIC_*` env vars are inlined into the JS bundle at build time. Make sure it's the **publishable** key (`pk_`), NEVER the secret (`sk_`). PagoKit's `no-hardcoded-keys` validator catches this.

## Anti-patterns

- ❌ Putting `STRIPE_SECRET_KEY` on the client. Rule 1 fail. Use `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` only.
- ❌ Calling `loadStripe()` inside the component body — re-runs on every render, throws. Call it at module scope.
- ❌ Not providing `clientSecret` to `<Elements options={{...}}>` — Payment Element won't render.
- ❌ Skipping the loading state — users see a flash of "no form".
- ❌ Granting access in `useEffect` after `paymentIntent.status === 'succeeded'`. Always wait for the webhook.

## Security rules cited

- Rule 1: only publishable key on the client.
- Rule 12: PAN never touches your server (Stripe Elements iframes the inputs).
