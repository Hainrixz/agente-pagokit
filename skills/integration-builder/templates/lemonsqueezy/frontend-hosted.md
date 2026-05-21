# Lemon Squeezy — Frontend Hosted Template

The default and recommended flow for Lemon Squeezy. The user clicks "Buy", your server creates a checkout URL via `createCheckout()`, and the browser either redirects to `<store>.lemonsqueezy.com/checkout/buy/<variant>` OR opens the overlay in-page.

## Component (redirect mode)

```tsx
// components/CheckoutButton.tsx
'use client';

import { useState } from 'react';

interface CheckoutButtonProps {
  productId: string;
  label?: string;
}

export function CheckoutButton({ productId, label = 'Comprar ahora' }: CheckoutButtonProps) {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'No se pudo iniciar el checkout.');
      }
      const { url } = await res.json();
      window.location.href = url;
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

## Component (overlay mode)

If the user prefers an in-page overlay:

```tsx
// components/CheckoutButtonOverlay.tsx
'use client';

import { useState } from 'react';
import Script from 'next/script';

declare global {
  interface Window {
    LemonSqueezy?: {
      Setup: (opts: { eventHandler?: (e: any) => void }) => void;
      Url: { Open: (url: string) => void; Close: () => void };
    };
    createLemonSqueezy?: () => void;
  }
}

export function CheckoutButtonOverlay({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  function handleScriptLoad() {
    // Hook into events (purchase complete, modal close, etc.)
    window.LemonSqueezy?.Setup({
      eventHandler: (event) => {
        // event.event: 'Checkout.Success' | 'PaymentMethodUpdate.Success' | etc.
        if (event.event === 'Checkout.Success') {
          window.location.href = '/checkout/success';
        }
      },
    });
  }

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const { url } = await res.json();
    window.LemonSqueezy?.Url.Open(url);
    setLoading(false);
  }

  return (
    <>
      <Script
        src="https://app.lemonsqueezy.com/js/lemon.js"
        strategy="afterInteractive"
        onLoad={handleScriptLoad}
      />
      <button onClick={handleClick} disabled={loading}>
        {loading ? 'Cargando…' : 'Comprar ahora'}
      </button>
    </>
  );
}
```

The overlay version requires `embed: true` in the server-side `createCheckout` call (see `one-time.md`).

## Return URL handling

```tsx
// app/checkout/success/page.tsx
export default function SuccessPage() {
  // The webhook order_created is the source of truth.
  // This page just renders a generic "thanks" message.
  return (
    <main>
      <h1>¡Gracias por tu compra!</h1>
      <p>Recibirás un email con el acceso. Si tarda más de 5 minutos, contáctanos.</p>
    </main>
  );
}
```

## Pre-filling customer data

LS supports pre-filling email, name, and country in the checkout when you provide them on the server side via `checkoutData`:

```ts
// Already shown in templates/lemonsqueezy/one-time.md
checkoutData: {
  email: session.user.email ?? undefined,
  name: session.user.name ?? undefined,
  country: session.user.country ?? undefined,
  custom: { user_id: session.user.id },
}
```

Don't ask the user for these fields on your page — pre-fill and let LS handle the rest.

## Anti-patterns

- ❌ Granting access on `Checkout.Success` event from the overlay. Wait for `order_created` webhook.
- ❌ Collecting tax_id, billing details, VAT number on your page. LS handles all of it.
- ❌ Showing the LS order ID as the user's "receipt number" — use your own.
- ❌ Mixing test/live modes by hardcoding URLs. Derive from API key prefix server-side.
- ❌ Embedding LS in an iframe yourself — use the official overlay script or redirect.

## Security rules cited

- Rule 12: hosted checkout — PAN never touches your frontend or backend.
