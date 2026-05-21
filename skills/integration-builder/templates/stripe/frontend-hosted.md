# Stripe — Frontend Hosted Checkout

Pattern when `frontend_style: hosted` is chosen. The user clicks a button, the server creates a Checkout Session, and the browser redirects to Stripe's hosted checkout page (`checkout.stripe.com`). After payment the user returns to `success_url` or `cancel_url`.

**When to choose this:**
- Fastest to ship, lowest maintenance.
- Lowest PCI scope (Stripe's page, your code never sees card data).
- Less brand control than embedded.
- Recommended for one-time charges and most subscriptions.

## React component

```tsx
// components/CheckoutButton.tsx
'use client';

import { useState } from 'react';

interface CheckoutButtonProps {
  productId: string;
  quantity?: number;
  label?: string;
}

export function CheckoutButton({ productId, quantity = 1, label = 'Comprar ahora' }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'No se pudo iniciar el checkout.');
      }
      const { url } = await res.json();
      window.location.href = url; // Redirect to Stripe Checkout
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? 'Procesando…' : label}
      </button>
      {error && (
        <p role="alert" style={{ color: 'red', marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
```

## Usage

```tsx
// app/(marketing)/page.tsx
import { CheckoutButton } from '@/components/CheckoutButton';

export default function Page() {
  return (
    <main>
      <h1>Mi ebook</h1>
      <p>20 USD</p>
      <CheckoutButton productId="ebook_main" label="Comprar — $20" />
    </main>
  );
}
```

## Success and cancel pages

```tsx
// app/checkout/success/page.tsx
export default function SuccessPage({ searchParams }: { searchParams: { session_id?: string } }) {
  // The session_id confirms the user came from a real Stripe Checkout completion.
  // Server-side: optionally fetch the session and verify status, but the source of truth
  // is the webhook (payment_intent.succeeded). This page is mostly UX confirmation.
  return (
    <main>
      <h1>¡Gracias!</h1>
      <p>Recibirás un email con tu compra en unos minutos.</p>
    </main>
  );
}
```

```tsx
// app/checkout/cancel/page.tsx
export default function CancelPage() {
  return (
    <main>
      <h1>Compra cancelada</h1>
      <p>No se realizó ningún cargo. <a href="/">Volver</a>.</p>
    </main>
  );
}
```

## Server-side verification (optional but recommended)

The success page CAN re-check the session status, but the **webhook is the source of truth** for granting access. Pattern:

```tsx
// app/checkout/success/page.tsx
import { stripe } from '@/lib/payments/stripe';

export default async function SuccessPage({ searchParams }: { searchParams: { session_id?: string } }) {
  if (!searchParams.session_id) return <p>Sesión no encontrada.</p>;

  const session = await stripe.checkout.sessions.retrieve(searchParams.session_id);

  if (session.payment_status !== 'paid') {
    return <p>El pago aún se está procesando.</p>;
  }

  // The webhook payment_intent.succeeded should have already marked the order paid in your DB.
  // This page just renders the confirmation; don't grant access here based on the session alone.
  return <p>¡Gracias por tu compra!</p>;
}
```

## Anti-patterns

- ❌ Granting product access on the success page based on `session.payment_status === 'paid'`. Use the webhook instead — the success page can be reloaded, can be bypassed entirely, and ACH payments take days to complete.
- ❌ Showing the `session_id` to the user as a "receipt number". It's a Stripe-internal id; show your own order id from the webhook handler.
- ❌ Hardcoding `https://checkout.stripe.com/...` in your code. Always use the `url` Stripe returns from `sessions.create`.
- ❌ Not handling the network error case in the click handler — users will tap repeatedly.

## Security rules cited

- Rule 12: hosted checkout means your frontend never sees PAN; lowest PCI scope.
