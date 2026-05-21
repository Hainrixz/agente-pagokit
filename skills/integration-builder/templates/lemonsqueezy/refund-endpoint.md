# Lemon Squeezy — Refund Endpoint Template

Lemon Squeezy refunds are typically issued from the dashboard (LS has its own refund policy and dispute handling as MoR). Phase 1 generates a thin `/api/refund` endpoint that calls the LS API — most teams will use the dashboard, but having a programmatic path matters for support flows and bulk refunds.

## Next.js App Router

```ts
// app/api/refund/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface RefundInput {
  paymentId: string; // your DB id
  amount?: number; // optional partial refund in cents (LS uses cents)
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user || !session.user.canRefund) {
    return new NextResponse(null, { status: 403 });
  }

  const { paymentId, amount }: RefundInput = await request.json();

  const payment = await db.pagokitPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'lemonsqueezy') {
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
  }

  // LS refund API: POST /v1/orders/{order_id}/refund
  try {
    const res = await fetch(
      `https://api.lemonsqueezy.com/v1/orders/${payment.provider_payment_id}/refund`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'refunds',
            attributes: amount ? { amount } : {},
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('[ls.refund] failed', {
        status: res.status,
        code: errBody?.errors?.[0]?.code ?? 'unknown',
      });
      return NextResponse.json({ error: 'refund_failed' }, { status: 500 });
    }

    const refund = await res.json();

    // The webhook order_refunded will arrive; dedup-safe to update here too.
    await db.pagokitPayment.update({
      where: { id: payment.id },
      data: { status: 'refunded' },
    });

    return NextResponse.json({
      refund_id: refund?.data?.id,
      status: 'refunded',
    });
  } catch (err: any) {
    console.error('[ls.refund] exception', { code: err.code ?? 'unknown' });
    return NextResponse.json({ error: 'refund_failed' }, { status: 500 });
  }
}
```

## Express equivalent

```ts
router.post('/api/refund', requireAuth, requireRefundPermission, async (req, res) => {
  const { paymentId, amount } = req.body;
  const payment = await db.pagokitPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'lemonsqueezy') {
    return res.status(404).json({ error: 'payment_not_found' });
  }

  const r = await fetch(
    `https://api.lemonsqueezy.com/v1/orders/${payment.provider_payment_id}/refund`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({ data: { type: 'refunds', attributes: amount ? { amount } : {} } }),
    }
  );
  if (!r.ok) return res.status(500).json({ error: 'refund_failed' });

  await db.pagokitPayment.update({
    where: { id: payment.id },
    data: { status: 'refunded' },
  });
  res.json({ status: 'refunded' });
});
```

## Refund constraints under MoR

LS as MoR has stricter refund rules than direct processors:

- **Time limit**: 30-60 days from the original charge for self-serve; older refunds require LS support.
- **Partial refunds**: supported via `amount` (in cents).
- **Tax**: LS adjusts the tax remittance automatically — you don't reconcile tax for refunded orders yourself.
- **Subscriptions**: refunding the *order* doesn't cancel the subscription. Use `updateSubscription(id, { cancelled: true })` separately if needed.

## Anti-patterns

- ❌ Refunding without auth check — admins / support reps only.
- ❌ Not waiting for the webhook to mark the DB row `refunded`. Race condition with the API response.
- ❌ Bulk refunding from a script without rate limiting — LS API throttles.
- ❌ Trying to refund a subscription's recurring charges in bulk from your code. Cancel the subscription via API + let LS handle the prorated refund per their policy.

## Security rules cited

- Rule 11: log `{ refunded_by, payment_db_id }` only.
