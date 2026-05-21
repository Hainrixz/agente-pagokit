# Wompi — Frontend Widget Template

Wompi's official frontend integration loads a script from `https://checkout.wompi.co/widget.js` and renders a button that opens a modal with all enabled payment methods (cards, PSE, Nequi, Bancolombia, cash vouchers).

## Script + container component

```tsx
// components/WompiCheckoutButton.tsx
'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

interface WompiCheckoutButtonProps {
  productId: string;
  quantity?: number;
  label?: string;
}

interface InitData {
  reference: string;
  amountInCents: number;
  currency: 'COP';
  integritySignature: string;
  publicKey: string;
  redirectUrl: string;
}

export function WompiCheckoutButton({
  productId,
  quantity = 1,
  label = 'Pagar con Wompi',
}: WompiCheckoutButtonProps) {
  const [init, setInit] = useState<InitData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/wompi/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'No se pudo iniciar el checkout.');
      }
      const data: InitData = await res.json();
      setInit(data);

      // Open the widget once we have the integrity signature
      // @ts-expect-error — WidgetCheckout is global from widget.js
      const checkout = new WidgetCheckout({
        currency: data.currency,
        amountInCents: data.amountInCents,
        reference: data.reference,
        publicKey: data.publicKey,
        redirectUrl: data.redirectUrl,
        signature: { integrity: data.integritySignature },
      });

      checkout.open((result: any) => {
        // result.transaction.status: APPROVED | DECLINED | PENDING | ERROR
        // DO NOT grant access here — wait for the webhook.
        if (result?.transaction?.status === 'APPROVED') {
          window.location.href = `${data.redirectUrl}?status=success`;
        } else if (result?.transaction?.status === 'PENDING') {
          window.location.href = `${data.redirectUrl}?status=pending`;
        } else {
          window.location.href = `${data.redirectUrl}?status=failed`;
        }
      });

      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <>
      <Script src="https://checkout.wompi.co/widget.js" strategy="afterInteractive" />
      <div>
        <button type="button" onClick={handleClick} disabled={loading} aria-busy={loading}>
          {loading ? 'Procesando…' : label}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </>
  );
}
```

## Usage

```tsx
import { WompiCheckoutButton } from '@/components/WompiCheckoutButton';

export default function Page() {
  return (
    <main>
      <h1>Mi curso</h1>
      <p>COP $50,000</p>
      <WompiCheckoutButton productId="curso_main" label="Pagar COP $50,000" />
    </main>
  );
}
```

## TypeScript declaration for WidgetCheckout

If your tsconfig is strict, add a global declaration:

```ts
// types/wompi.d.ts
declare global {
  interface WidgetCheckoutOptions {
    currency: 'COP';
    amountInCents: number;
    reference: string;
    publicKey: string;
    redirectUrl: string;
    signature: { integrity: string };
    expirationTime?: string;
  }
  class WidgetCheckout {
    constructor(options: WidgetCheckoutOptions);
    open(callback: (result: { transaction?: any }) => void): void;
  }
}
export {};
```

## Cash-voucher UX (PENDING state)

When the customer chooses Efecty / Baloto / Su Red, the Widget closes with `transaction.status === 'PENDING'` and an instruction sheet for the cash payment. They have up to 72 hours to pay. Your UI should:

```tsx
if (result.transaction.status === 'PENDING') {
  // Show: "Pago pendiente. Ve a Efecty/Baloto en las próximas 72 horas con el número de referencia X."
  window.location.href = `${data.redirectUrl}?status=pending&reference=${result.transaction.reference}`;
}
```

The `transaction.updated` webhook fires when the cash payment completes (or after 72h with `DECLINED`).

## Anti-patterns

- ❌ Exposing `WOMPI_PRIVATE_KEY` or `WOMPI_INTEGRITY_SECRET` to the browser. Only the public key + the server-computed integrity signature.
- ❌ Generating the integrity signature on the frontend. The integrity secret would leak.
- ❌ Loading widget.js with `strategy="beforeInteractive"` — page load slows. Use `afterInteractive`.
- ❌ Granting access on the `APPROVED` callback. The webhook is the source of truth.
- ❌ Skipping the PENDING UX flow — cash payments are a real and common path.

## Security rules cited

- Rule 1: only public key on the client.
- Rule 12: PAN tokenized by the Widget; never reaches your server.
