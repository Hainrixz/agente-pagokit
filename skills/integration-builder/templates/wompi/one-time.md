# Wompi — One-time Payment Template

Creates a one-time charge via the Widget (client-side tokenization) or the Web Checkout redirect.

## Reference generation + integrity signature endpoint

This endpoint returns the data the frontend needs to initialize the Wompi Widget: a unique `reference`, the amount in centavos, the currency, and the integrity signature.

```ts
// app/api/checkout/wompi/init/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface InitInput {
  productId: string;
  quantity?: number;
}

export async function POST(request: Request) {
  const { productId, quantity = 1 } = (await request.json()) as InitInput;

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }
  if (product.currency !== 'COP') {
    return NextResponse.json({ error: 'currency_unsupported' }, { status: 400 });
  }

  // Rule 4: server-generated UUID — Wompi uses `reference` as idempotency token
  const reference = `order_${product.id}_${randomUUID()}`;
  const amountInCents = Math.round(product.price * 100);

  // Compute integrity signature so the Widget can be initialized
  const concatenation = `${reference}${amountInCents}COP${process.env.WOMPI_INTEGRITY_SECRET}`;
  const integritySignature = crypto.createHash('sha256').update(concatenation).digest('hex');

  // Persist the pending payment row so the webhook can reconcile on `transaction.updated`
  await db.pagokitPayment.create({
    data: {
      provider: 'wompi',
      provider_payment_id: reference, // we'll replace this with the real tx id from webhook
      amount: amountInCents,
      currency: 'COP',
      status: 'pending',
      metadata: { reference, product_id: product.id },
    },
  });

  return NextResponse.json({
    reference,
    amountInCents,
    currency: 'COP',
    integritySignature,
    publicKey: process.env.WOMPI_PUBLIC_KEY,
    redirectUrl: `${process.env.PUBLIC_URL}/checkout/wompi/return`,
  });
}
```

## Reconcile on webhook

When `transaction.updated` fires, the handler updates the row by `reference` (we stored it in `metadata`):

```ts
// in app/api/webhook/wompi/route.ts (extend handleTransactionUpsert)
async function handleTransactionUpsert(tx: any) {
  // Wompi transaction.id is the canonical id. Match by reference if pre-created, then update.
  const existing = await db.pagokitPayment.findFirst({
    where: { provider: 'wompi', metadata: { path: ['reference'], equals: tx.reference } },
  });
  if (existing) {
    await db.pagokitPayment.update({
      where: { id: existing.id },
      data: {
        provider_payment_id: tx.id, // replace temp reference with real tx id
        status: mapWompiStatus(tx.status),
        metadata: { ...((existing.metadata as any) ?? {}), method: tx.payment_method_type },
      },
    });
  } else {
    // Fallback: never pre-created, just insert
    await db.pagokitPayment.create({
      data: {
        provider: 'wompi',
        provider_payment_id: tx.id,
        amount: tx.amount_in_cents,
        currency: tx.currency,
        status: mapWompiStatus(tx.status),
        metadata: { reference: tx.reference, method: tx.payment_method_type },
      },
    });
  }
}
```

## Web Checkout (redirect) variant

Alternative to the Widget — redirect the user to `https://checkout.wompi.co/p/?...` with query params:

```ts
const checkoutUrl = new URL('https://checkout.wompi.co/p/');
checkoutUrl.searchParams.set('public-key', process.env.WOMPI_PUBLIC_KEY!);
checkoutUrl.searchParams.set('currency', 'COP');
checkoutUrl.searchParams.set('amount-in-cents', String(amountInCents));
checkoutUrl.searchParams.set('reference', reference);
checkoutUrl.searchParams.set('signature:integrity', integritySignature);
checkoutUrl.searchParams.set('redirect-url', `${process.env.PUBLIC_URL}/checkout/wompi/return`);

return NextResponse.json({ url: checkoutUrl.toString() });
```

The user redirects to Wompi's hosted checkout page, pays, and returns to `redirect-url` with query params identifying the transaction. The webhook is still the source of truth for marking the payment complete.

## Return page

```tsx
// app/checkout/wompi/return/page.tsx
export default function ReturnPage({ searchParams }: { searchParams: any }) {
  // searchParams includes id, status, env — but DO NOT trust them for granting access.
  // Wait for the webhook.
  return (
    <main>
      <h1>Procesando tu pago…</h1>
      <p>Verifica tu correo en unos minutos para la confirmación.</p>
    </main>
  );
}
```

## Anti-patterns

- ❌ Trusting the `status` / `id` from the redirect query params. The webhook is the only trusted source.
- ❌ Re-using the same `reference` across users — must be globally unique.
- ❌ Skipping the integrity signature — Wompi rejects the Widget initialization.
- ❌ Sending amount in pesos (`5000` instead of `500000` for COP $5,000) — Wompi will reject or charge the wrong amount.
- ❌ Forgetting to update the temp `provider_payment_id` from the pending insert. After webhook, it should be the real Wompi tx id.

## Security rules cited

- Rule 4: server-generated UUID as `reference`.
- Rule 11: minimum metadata stored (reference, product_id, method).
- Rule 12: no card data at any point — Widget handles tokenization.
