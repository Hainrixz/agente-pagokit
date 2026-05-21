# Mercado Pago — Frontend Embedded (Bricks)

Pattern when `frontend_style: embedded` is chosen. Uses Mercado Pago Bricks SDK to render a Payment Brick on your page, tokenize the card client-side, and POST `{ token, payment_method_id, installments, payerEmail }` to your `/api/checkout/charge` endpoint.

## Install

```bash
npm install @mercadopago/sdk-react
```

## Required public env var

```
NEXT_PUBLIC_MP_PUBLIC_KEY=APP_USR-…
```

⚠️ Public key only, NEVER the access token. PagoKit's `no-hardcoded-keys` validator catches this.

## Initialize the SDK

```tsx
// app/providers.tsx (or wherever your React root is wrapped)
'use client';

import { useEffect, useState } from 'react';
import { initMercadoPago } from '@mercadopago/sdk-react';

export function MpProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initMercadoPago(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY!, { locale: 'es-MX' });
    setReady(true);
  }, []);
  return ready ? <>{children}</> : null;
}
```

Adjust `locale` per detected country: `es-AR`, `es-MX`, `es-CO`, `es-CL`, `es-PE`, `es-UY`, `pt-BR`.

## Payment Brick component

```tsx
// components/CheckoutBrick.tsx
'use client';

import { Payment } from '@mercadopago/sdk-react';
import type {
  IPaymentBrickCustomization,
  IPaymentFormData,
} from '@mercadopago/sdk-react/payment/type';

interface CheckoutBrickProps {
  productId: string;
  amount: number;
  payerEmail: string;
}

export function CheckoutBrick({ productId, amount, payerEmail }: CheckoutBrickProps) {
  const initialization = {
    amount,
    payer: { email: payerEmail },
  };

  const customization: IPaymentBrickCustomization = {
    paymentMethods: {
      creditCard: 'all',
      debitCard: 'all',
      ticket: 'all', // OXXO, Boleto, etc.
      bankTransfer: ['pix'], // Brazil
      maxInstallments: 12,
    },
  };

  async function onSubmit({ formData }: { formData: IPaymentFormData }) {
    const res = await fetch('/api/checkout/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        token: formData.token,
        paymentMethodId: formData.payment_method_id,
        installments: formData.installments,
        payerEmail: formData.payer.email,
      }),
    });
    if (!res.ok) {
      throw new Error('charge_failed');
    }
    const { status } = await res.json();
    if (status === 'approved') {
      window.location.href = '/checkout/success';
    } else if (status === 'in_process') {
      window.location.href = '/checkout/pending';
    } else {
      window.location.href = '/checkout/failure';
    }
  }

  function onError(error: any) {
    console.error('[mp.brick] error', { code: error?.cause?.[0]?.code ?? 'unknown' });
    // Rule 6: do not log full error
  }

  return (
    <Payment
      initialization={initialization}
      customization={customization}
      onSubmit={onSubmit}
      onError={onError}
    />
  );
}
```

## Usage

```tsx
// app/(checkout)/page.tsx
'use client';

import { MpProvider } from '@/app/providers';
import { CheckoutBrick } from '@/components/CheckoutBrick';

export default function CheckoutPage() {
  // amount + payerEmail come from session / cart
  return (
    <MpProvider>
      <CheckoutBrick productId="ebook" amount={399.0} payerEmail="user@example.com" />
    </MpProvider>
  );
}
```

## Server-side endpoint

See [`one-time.md`](./one-time.md) `Custom: charge directly with a card token` for the server-side `/api/checkout/charge` route. It receives `{ token, paymentMethodId, installments, payerEmail }` and creates the payment.

## Country-specific Bricks

- **Brasil (Pix)**: include `bankTransfer: ['pix']` in `customization.paymentMethods`. Brick renders a "Pagar com Pix" tab that shows a QR code post-confirmation.
- **México (OXXO)**: `ticket: 'all'` shows OXXO and other voucher options.
- **Argentina (Rapipago, Pago Fácil)**: same `ticket: 'all'`.
- **Colombia (PSE)**: `bankTransfer: ['pse']`.

## Anti-patterns

- ❌ Calling `initMercadoPago` inside a component body — re-inits on each render. Module scope or `useEffect`.
- ❌ Putting the access token (`APP_USR-…` long format) on the frontend. Only the short public key.
- ❌ Not awaiting `onSubmit` resolution — Brick will look frozen on slow networks.
- ❌ Skipping `onError` — silent failures.
- ❌ Granting access on `status === 'approved'` from the brick callback. The webhook is the source of truth (especially for ticket / Pix where confirmation is async).

## Security rules cited

- Rule 1: only public key on the client.
- Rule 12: PAN tokenized by Bricks; never reaches your server.
