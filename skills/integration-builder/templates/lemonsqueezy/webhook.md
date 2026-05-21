# Lemon Squeezy — Webhook Template

Verifies `X-Signature` HMAC-SHA256 over the raw body. **No timestamp** — event-id dedup is the only defense against replay attacks (Rule 9).

## Next.js App Router

```ts
// app/api/webhook/lemonsqueezy/route.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface LemonEvent {
  meta: {
    event_name: string;
    custom_data?: Record<string, any>;
    event_id?: string;
  };
  data: any;
}

export async function POST(request: Request) {
  // Rule 10: body size guard
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  const signature = request.headers.get('x-signature');
  if (!signature) return new NextResponse(null, { status: 400 });

  // Rule 5: raw body
  const rawBody = await request.text();

  // Rule 3: HMAC verification
  if (!verifyLemonSignature(rawBody, signature, process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)) {
    return new NextResponse(null, { status: 400 });
  }

  let event: LemonEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 9 MANDATORY: dedup by event id (LS doesn't sign timestamps)
  // LS provides event_id in meta. If absent (older webhooks), fall back to a hash of the body.
  const eventId =
    event.meta?.event_id ??
    crypto.createHash('sha256').update(rawBody).digest('hex');

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: `ls:${eventId}`,
        provider: 'lemonsqueezy',
        event_type: event.meta?.event_name ?? 'unknown',
        expires_at: expiresAt,
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Rule 6: log metadata only
  console.log('[lemonsqueezy.webhook]', {
    event: event.meta?.event_name,
    event_id: eventId,
    object_id: event.data?.id,
  });

  try {
    switch (event.meta?.event_name) {
      case 'order_created':
        await handleOrderCreated(event.data, event.meta.custom_data);
        break;
      case 'subscription_created':
        await handleSubscriptionCreated(event.data, event.meta.custom_data);
        break;
      case 'subscription_updated':
        await handleSubscriptionUpdated(event.data);
        break;
      case 'subscription_cancelled':
        await handleSubscriptionCancelled(event.data);
        break;
      case 'subscription_payment_success':
        await handleSubscriptionPaymentSuccess(event.data);
        break;
      case 'subscription_payment_failed':
        await handleSubscriptionPaymentFailed(event.data);
        break;
      case 'subscription_payment_refunded':
      case 'order_refunded':
        await handleRefund(event.data);
        break;
      default:
        console.log('[lemonsqueezy.webhook] unhandled event', event.meta?.event_name);
    }
  } catch (err: any) {
    console.error('[lemonsqueezy.webhook] handler error', { error_code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyLemonSignature(rawBody: string, signature: string, secret: string): boolean {
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (computed.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

// Stub handlers — real implementations grant/revoke entitlements
async function handleOrderCreated(data: any, customData?: Record<string, any>) {
  const attributes = data.attributes;
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: String(data.id) },
    create: {
      provider: 'lemonsqueezy',
      provider_payment_id: String(data.id),
      amount: attributes.total, // already in cents
      currency: attributes.currency,
      status: 'succeeded',
      metadata: {
        user_id: customData?.user_id ?? null,
        product_id: attributes.first_order_item?.product_id,
      },
    },
    update: { status: 'succeeded' },
  });
}

async function handleSubscriptionCreated(data: any, customData?: Record<string, any>) {
  const attrs = data.attributes;
  // Upsert customer first
  // ... then subscription
}

async function handleSubscriptionUpdated(data: any) { /* update status, plan */ }
async function handleSubscriptionCancelled(data: any) { /* revoke entitlements at period end */ }
async function handleSubscriptionPaymentSuccess(data: any) { /* extend access */ }
async function handleSubscriptionPaymentFailed(data: any) { /* dunning notification */ }
async function handleRefund(data: any) {
  await db.pagokitPayment.update({
    where: { provider_payment_id: String(data.id) },
    data: { status: 'refunded' },
  });
}
```

## Required events minimum

From `providers.json.lemonsqueezy.webhook.required_events_minimum`:

- `order_created`
- `subscription_created`
- `subscription_updated`
- `subscription_cancelled`
- `subscription_payment_failed`
- `subscription_payment_refunded`

The "Configure events" step in the LS webhook dashboard must subscribe to all of these.

## `custom_data` round-trip

When creating a checkout via `createCheckout()`, you can include `checkout_data.custom` with your own JSON. LS sends it back on every related webhook in `event.meta.custom_data`. Use this to attach your internal `user_id`:

```ts
// When creating the checkout:
const checkout = await createCheckout(storeId, variantId, {
  checkoutData: {
    custom: { user_id: '<your user id>' },
  },
});

// In the webhook, retrieve it:
const userId = event.meta?.custom_data?.user_id;
```

## Anti-patterns

- ❌ **Skipping event-id dedup.** LS doesn't sign timestamps. Without dedup, an attacker who captures one webhook can replay it indefinitely.
- ❌ Using `===` to compare HMAC outputs — timing attack vector. Use `timingSafeEqual`.
- ❌ Calling `JSON.parse(rawBody)` before verifying — wastes CPU on potentially-forged events.
- ❌ Returning 4xx for unknown events — LS retries, eventually unsubscribes. Return 200 with log.
- ❌ Granting access in `handleOrderCreated` without resolving `custom_data.user_id` — you'll have orphan payments.

## Security rules cited

- Rule 3: HMAC verification.
- Rule 5: raw body before parse.
- Rule 6: log metadata only.
- Rule 9: event-id dedup MANDATORY (LS has no timestamp).
- Rule 10: body size cap.
