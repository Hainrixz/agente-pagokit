# Mercado Pago — Frontend Hosted (Checkout Pro)

Pattern when `frontend_style: hosted` is chosen for MP. The user clicks a button, your server creates a `Preference`, and the browser redirects to MP's hosted Checkout Pro page.

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

export function CheckoutButton({
  productId,
  quantity = 1,
  label = 'Comprar ahora',
}: CheckoutButtonProps) {
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
      const { url, sandbox_url } = await res.json();
      // In sandbox, use sandbox_url; in production, url
      const target = process.env.NEXT_PUBLIC_MP_ENV === 'production' ? url : sandbox_url;
      window.location.href = target;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={loading} aria-busy={loading}>
        {loading ? 'Procesando…' : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

## Sandbox vs production routing

MP returns both `init_point` (production) and `sandbox_init_point` from `Preference.create()`. Use the environment variable `NEXT_PUBLIC_MP_ENV` (set to `production` or `sandbox`) to switch — keep test users routed through the sandbox URL even with test access tokens.

## Return URLs (back_urls)

The Preference was created with `back_urls` and `auto_return: 'approved'`. The user is redirected back to:

- `/checkout/success` on approved
- `/checkout/failure` on rejected
- `/checkout/pending` on pending (e.g., Boleto / OXXO awaiting cash deposit)

```tsx
// app/checkout/success/page.tsx
export default function SuccessPage({ searchParams }: { searchParams: any }) {
  // searchParams will include collection_status, collection_id, preference_id, payment_id
  // Do NOT grant access here — wait for the webhook.
  return (
    <main>
      <h1>¡Gracias!</h1>
      <p>Recibirás un correo cuando tu pago se confirme.</p>
    </main>
  );
}
```

```tsx
// app/checkout/pending/page.tsx
export default function PendingPage() {
  return (
    <main>
      <h1>Pago pendiente</h1>
      <p>Tu pago se procesará una vez que completes el método elegido (OXXO, Boleto, transferencia).</p>
    </main>
  );
}
```

## Anti-patterns

- ❌ Granting product access on the success page — wait for the webhook (especially for ticket payments which can take 24-48h).
- ❌ Mixing `init_point` and `sandbox_init_point` (one of them will reject test users).
- ❌ Showing the MP `preference_id` as a "receipt number" — show your own `external_reference`.
- ❌ Reusing the same Preference across users — preferences are short-lived and bound to a notification URL.

## Security rules cited

- Rule 12: hosted checkout means PAN never touches your frontend.
