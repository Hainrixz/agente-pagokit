# Mercado Pago — One-time Payment Template

Creates a one-time charge via either `Preference` (hosted Checkout Pro) or `Payment` (custom with a card token from Bricks).

## Hosted: create a Preference (Checkout Pro)

```ts
// app/api/checkout/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mpPreference } from '@/lib/payments/mercadopago';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface CheckoutInput {
  productId: string;
  quantity?: number;
}

export async function POST(request: Request) {
  const { productId, quantity = 1 } = (await request.json()) as CheckoutInput;

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  const idempotencyKey = randomUUID(); // Rule 4

  const preference = await mpPreference.create({
    body: {
      items: [
        {
          id: product.id,
          title: product.name,
          quantity,
          unit_price: Number(product.price.toFixed(2)),
          currency_id: product.currency,
        },
      ],
      back_urls: {
        success: `${process.env.PUBLIC_URL}/checkout/success`,
        failure: `${process.env.PUBLIC_URL}/checkout/failure`,
        pending: `${process.env.PUBLIC_URL}/checkout/pending`,
      },
      auto_return: 'approved',
      notification_url: `${process.env.PUBLIC_URL}/api/webhook/mercadopago`,
      external_reference: `order_${product.id}_${Date.now()}`,
      // Optional: restrict installments
      payment_methods: {
        installments: 12, // up to 12 cuotas in MX/BR/AR
      },
    },
    requestOptions: { idempotencyKey },
  });

  return NextResponse.json({
    url: preference.init_point, // production URL
    sandbox_url: preference.sandbox_init_point, // test URL
  });
}
```

## Custom: charge directly with a card token

If the user has Bricks on the frontend (`frontend-embedded.md`), the frontend tokenizes the card and sends `payment_method_id` + `token` to your endpoint:

```ts
// app/api/checkout/charge/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mpPayment } from '@/lib/payments/mercadopago';

export const runtime = 'nodejs';

interface ChargeInput {
  productId: string;
  token: string; // from Bricks frontend
  paymentMethodId: string; // e.g., 'master', 'visa', 'pix', 'oxxo'
  installments?: number;
  payerEmail: string;
}

export async function POST(request: Request) {
  const input = (await request.json()) as ChargeInput;

  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const payment = await mpPayment.create({
      body: {
        transaction_amount: Number(product.price.toFixed(2)),
        token: input.token,
        description: product.name,
        installments: input.installments ?? 1,
        payment_method_id: input.paymentMethodId,
        payer: { email: input.payerEmail },
        external_reference: `order_${product.id}_${Date.now()}`,
        notification_url: `${process.env.PUBLIC_URL}/api/webhook/mercadopago`,
      },
      requestOptions: { idempotencyKey },
    });

    return NextResponse.json({
      status: payment.status,
      payment_id: payment.id,
    });
  } catch (err: any) {
    console.error('[mp.charge] failed', { code: err?.error?.code ?? 'unknown' });
    return NextResponse.json({ error: 'charge_failed' }, { status: 500 });
  }
}
```

## Pix-first flow (Brazil)

To force Pix-only checkout:

```ts
const preference = await mpPreference.create({
  body: {
    items: [...],
    payment_methods: {
      excluded_payment_types: [
        { id: 'credit_card' },
        { id: 'debit_card' },
        { id: 'ticket' },
        { id: 'atm' },
      ],
      // leaves: 'bank_transfer' (which includes Pix in BR)
    },
    ...
  },
});
```

## Cash voucher flow (OXXO MX, Boleto BR, Rapipago AR)

```ts
const preference = await mpPreference.create({
  body: {
    items: [...],
    payment_methods: {
      excluded_payment_types: [
        { id: 'credit_card' },
        { id: 'debit_card' },
      ],
      // leaves: 'ticket' (OXXO, Boleto, Rapipago, PagoEfectivo)
    },
    ...
  },
});
```

The buyer receives a voucher URL; payment confirms via webhook 1-48h later (cash converts slower).

## Anti-patterns

- ❌ Trusting `transaction_amount` from the client. Look up price server-side.
- ❌ Forgetting `notification_url` on the Preference — webhooks never fire.
- ❌ Hardcoding `init_point` vs `sandbox_init_point` choice. Use a check on `process.env.NODE_ENV` or the access token prefix (`TEST-` → sandbox).
- ❌ Setting `currency_id` to an unsupported value for the seller's country (e.g., `USD` on a Mexican account that's not enabled for it).
- ❌ Skipping `payer.email` on direct charges — MP often requires it for fraud scoring.

## Security rules cited

- Rule 4: `randomUUID()` literal on `idempotencyKey`.
- Rule 11: collect only payer email server-side.
- Rule 12: PAN tokenized via Bricks; only `token` arrives at your endpoint.
