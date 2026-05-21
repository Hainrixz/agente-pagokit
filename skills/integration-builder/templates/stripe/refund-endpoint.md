# Stripe — Refund Endpoint Template

Generates `POST /api/refund` (auth-checked) to issue refunds from the merchant side. Every PagoKit Stripe integration ships with this — refunds-only-from-dashboard is a UX dead-end for any real product.

## Next.js App Router

```ts
// app/api/refund/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth'; // example — adapt to project's auth

export const runtime = 'nodejs';

interface RefundInput {
  paymentId: string; // your DB id, NOT the Stripe id
  amount?: number; // optional partial refund in cents; default = full
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export async function POST(request: Request) {
  // 1. AUTH: only authenticated admins / agents can refund
  const session = await getServerSession();
  if (!session?.user || !session.user.canRefund) {
    return new NextResponse(null, { status: 403 });
  }

  const { paymentId, amount, reason }: RefundInput = await request.json();

  // 2. Load the payment from your DB to get the provider charge id
  const payment = await db.pagokitPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'stripe') {
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
  }

  // 3. Stripe expects charge id OR payment_intent id
  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.provider_payment_id, // assumes you stored the PI id
        amount: amount, // omit for full refund
        reason: reason,
        metadata: {
          refunded_by: session.user.id,
          payment_db_id: payment.id,
        },
      },
      { idempotencyKey }
    );

    // 4. Update your DB (the webhook will also fire charge.refunded, dedup-safe)
    await db.pagokitPayment.update({
      where: { id: payment.id },
      data: { status: refund.status === 'succeeded' ? 'refunded' : payment.status },
    });

    return NextResponse.json({
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount,
    });
  } catch (err: any) {
    console.error('[refund] failed', { code: err.code, payment_id: paymentId });
    return NextResponse.json(
      { error: 'refund_failed', code: err.code ?? 'unknown' },
      { status: 500 }
    );
  }
}
```

## Express

```ts
// routes/refund.ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { stripe } from '../lib/payments/stripe';
import { requireAuth, requireRefundPermission } from '../middleware/auth';

const router = Router();

router.post('/api/refund', requireAuth, requireRefundPermission, async (req, res) => {
  const { paymentId, amount, reason } = req.body;
  const payment = await db.pagokitPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'stripe') {
    return res.status(404).json({ error: 'payment_not_found' });
  }

  const idempotencyKey = randomUUID(); // Rule 4

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.provider_payment_id,
        amount,
        reason,
        metadata: { refunded_by: req.user.id, payment_db_id: payment.id },
      },
      { idempotencyKey }
    );
    await db.pagokitPayment.update({
      where: { id: payment.id },
      data: { status: refund.status === 'succeeded' ? 'refunded' : payment.status },
    });
    res.json({ refund_id: refund.id, status: refund.status });
  } catch (err: any) {
    console.error('[refund] failed', { code: err.code });
    res.status(500).json({ error: 'refund_failed' });
  }
});

export default router;
```

## Partial refunds and refund webhook

When you specify `amount`, Stripe issues a partial refund. The webhook `charge.refunded` fires with the updated charge object including `refunds.data[]`. The webhook handler is the source of truth for state — this endpoint is just the trigger.

## Dispute handling (separate flow)

A *dispute* is the customer's bank reversing a charge (chargeback). The merchant cannot proactively refund a disputed charge — they must submit evidence via `stripe.disputes.update(id, { evidence: {...} })`. PagoKit Phase 1 generates a stub handler for `charge.dispute.created` in `webhook.md`; full evidence-submission flow ships in Phase 2.

## Anti-patterns

- ❌ Refunding from an unauthenticated endpoint. Always check the caller has admin / refund permission.
- ❌ Trusting `paymentId` from the client without looking up the actual payment_intent server-side.
- ❌ Refunding without `idempotencyKey` — a double-click becomes two refunds.
- ❌ Marking the payment as `refunded` immediately and not waiting for the webhook. Stripe's `status: 'pending'` refunds happen occasionally (ACH).
- ❌ Issuing a refund and emailing the user that it's "instant" — refunds take 5-10 business days to show on the customer's statement.

## Security rules cited

- Rule 4: `randomUUID()` for refund idempotency.
- Rule 11: log `refunded_by` for audit trail (PII minimum: user id, no extra data).
