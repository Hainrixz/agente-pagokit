# Mercado Pago — Refund Endpoint Template

Generates `POST /api/refund` for issuing refunds from the merchant side. MP supports total and partial refunds via the `/v1/payments/{id}/refunds` endpoint.

## Next.js App Router

```ts
// app/api/refund/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mpPayment, mpClient } from '@/lib/payments/mercadopago';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

interface RefundInput {
  paymentId: string; // your DB id, NOT the MP id
  amount?: number; // optional partial refund in major unit
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user || !session.user.canRefund) {
    return new NextResponse(null, { status: 403 });
  }

  const { paymentId, amount }: RefundInput = await request.json();

  const payment = await db.pagokitPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'mercadopago') {
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
  }

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    // MP SDK doesn't expose refunds on the Payment class in v2; use raw HTTP.
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${payment.provider_payment_id}/refunds`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: amount ? JSON.stringify({ amount: Number(amount.toFixed(2)) }) : '{}',
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('[mp.refund] failed', {
        code: errBody.error ?? 'unknown',
        status: response.status,
      });
      return NextResponse.json({ error: 'refund_failed' }, { status: 500 });
    }

    const refund = await response.json();

    // The webhook payment.updated will arrive with status=refunded; dedup-safe to update here too.
    await db.pagokitPayment.update({
      where: { id: payment.id },
      data: { status: 'refunded' },
    });

    return NextResponse.json({
      refund_id: refund.id,
      amount: refund.amount,
      status: refund.status,
    });
  } catch (err: any) {
    console.error('[mp.refund] error', { code: err.code ?? 'unknown' });
    return NextResponse.json({ error: 'refund_failed' }, { status: 500 });
  }
}
```

## Express equivalent

Same shape, wrapped in `router.post('/api/refund', requireAuth, ...)` with an auth middleware.

## Partial vs full refund

| Body | Effect |
|---|---|
| `{}` (empty) | Full refund of the original payment |
| `{ "amount": 50.0 }` | Partial refund of $50 (major unit) |

Multiple partial refunds against the same payment are allowed up to the original amount.

## Refund webhook

When the refund succeeds, MP fires `payment.updated` with `status: 'refunded'` (full) or keeps `status: 'approved'` with a non-zero `transaction_details.refunded_amount` (partial). The webhook handler already reconciles this via `mapMpStatus`.

## Anti-patterns

- ❌ Refunding from an unauthenticated endpoint. Always check the caller can refund.
- ❌ Skipping `X-Idempotency-Key` — double-click becomes two refunds.
- ❌ Marking the payment as `refunded` BEFORE the API call returns success — race condition with webhook.
- ❌ Returning the raw MP error to the client — leaks internal IDs.

## Security rules cited

- Rule 4: `randomUUID()` for refund idempotency.
- Rule 11: log only `refunded_by` from session, not the full MP response.
