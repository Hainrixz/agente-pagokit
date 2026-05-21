# Stripe — Webhook Template

Verifies `Stripe-Signature` HMAC-SHA256 with timestamp, dispatches the minimum required events, persists dedup state, and logs only `event.id|type|created`.

## Next.js App Router

```ts
// app/api/webhook/stripe/route.ts
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
// import { handleStripeEvent } from '@/lib/payments/handlers/stripe';

// Rule 5: Node runtime, not Edge
export const runtime = 'nodejs';

export async function POST(request: Request) {
  // Rule 10: body size guard
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new NextResponse(null, { status: 400 });

  // Rule 5: raw body for HMAC verification
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    // Rule 3 + Rule 9: signature verifies AND timestamp window (tolerance 300s default)
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 9 secondary defense: dedup by event.id
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: event.id,
        provider: 'stripe',
        event_type: event.type,
        expires_at: expiresAt,
      },
    });
  } catch {
    // already processed — idempotent return
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Rule 6: log only metadata, never payload
  console.log('[stripe.webhook]', {
    id: event.id,
    type: event.type,
    created: event.created,
  });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // TODO: handle event.type if needed (Rule 9: don't silence — log and continue)
        console.log('[stripe.webhook] unhandled event type', event.type);
    }
  } catch (err: any) {
    // Internal error → 500 makes Stripe retry. Dedup table prevents double-processing.
    console.error('[stripe.webhook] handler error', {
      id: event.id,
      type: event.type,
      error_code: err.code ?? 'unknown',
    });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Stub handlers — real implementations live in lib/payments/handlers/stripe.ts
async function handlePaymentSucceeded(pi: Stripe.PaymentIntent) { /* mark order paid */ }
async function handlePaymentFailed(pi: Stripe.PaymentIntent) { /* notify user */ }
async function handleChargeRefunded(c: Stripe.Charge) { /* update DB */ }
async function handleDisputeCreated(d: Stripe.Dispute) { /* alert ops */ }
async function handleInvoicePaymentFailed(i: Stripe.Invoice) { /* dunning */ }
async function handleSubscriptionUpdated(s: Stripe.Subscription) { /* update plan */ }
async function handleSubscriptionDeleted(s: Stripe.Subscription) { /* revoke access */ }
```

## Express

```ts
// app.ts
import express from 'express';
import Stripe from 'stripe';
import { stripe } from './lib/payments/stripe';

const app = express();

app.post(
  '/api/webhook/stripe',
  express.raw({ type: 'application/json', limit: '256kb' }), // Rule 5 + Rule 10
  async (req, res) => {
    const signature = req.headers['stripe-signature'] as string | undefined;
    if (!signature) return res.status(400).send();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, // Buffer thanks to express.raw
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      return res.status(400).send();
    }

    // dedup + switch router (same as Next.js example above)
    // ...

    res.status(200).json({ received: true });
  }
);

app.use(express.json()); // ← AFTER the webhook route
```

## Required events minimum (must be in the switch)

From `providers.json.stripe.webhook.required_events_minimum`:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `invoice.payment_failed`
- `customer.subscription.deleted`
- `customer.subscription.updated`

Generate stub handlers for all 7 even if `billing_mode == one_time` — the user may add subscriptions later, and silently dropping `charge.dispute.created` loses chargeback responses (Stripe deadline 7 days; merchant auto-loses past that).

## Anti-patterns

- ❌ `await request.json()` before `constructEvent` — HMAC fails.
- ❌ Reading `req.body` as parsed JSON in Express webhook (forgot `express.raw`).
- ❌ Catching the `constructEvent` error and proceeding anyway — defeats the purpose.
- ❌ Using `STRIPE_SECRET_KEY` instead of `STRIPE_WEBHOOK_SECRET` for verification — different secrets.
- ❌ Returning 4xx for unhandled event types — Stripe will eventually disable the endpoint. Return 200 with a TODO log.

## Security rules cited

- Rule 3: signature verification.
- Rule 5: raw body capture.
- Rule 6: log metadata only.
- Rule 9: replay protection via timestamp window + event-id dedup.
- Rule 10: body size cap.
