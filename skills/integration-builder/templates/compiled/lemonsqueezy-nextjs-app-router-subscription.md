# Compiled — Lemon Squeezy × Next.js App Router × Subscription

Pre-composed for global digital goods subscription on Next.js. LS handles tax + invoicing as MoR; you only handle entitlements.

**Spec match:**
- provider: `lemonsqueezy`
- stack: `nextjs-app-router`
- billing_mode: `subscription`
- frontend_style: `hosted` (LS hosted checkout)

**Composes:** `lemonsqueezy/{reference, subscription, webhook, refund-endpoint, errors, frontend-hosted}.md` + `_stack-adapters/nextjs-app-router.md`.

---

## Files generated

```
lib/payments/lemonsqueezy.ts
lib/payments/errors-lemonsqueezy.ts
app/api/checkout/subscribe/route.ts        # POST — creates LS checkout
app/api/portal/route.ts                    # POST — returns LS-hosted customer portal URL
app/api/refund/route.ts                    # POST — LS API refund
app/api/webhook/lemonsqueezy/route.ts      # POST — HMAC verify + dispatch
app/billing/success/page.tsx
components/SubscribeButton.tsx
components/ManageBillingButton.tsx
prisma/schema.prisma
.env.example
```

## `.env.example`

```
LEMONSQUEEZY_API_KEY=lmnsq_test_REPLACE_ME
LEMONSQUEEZY_STORE_ID=12345
LEMONSQUEEZY_WEBHOOK_SECRET=REPLACE_ME
LEMONSQUEEZY_PRO_VARIANT_ID=67890
PUBLIC_URL=http://localhost:3000
```

## `lib/payments/lemonsqueezy.ts`

```ts
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js';

if (!process.env.LEMONSQUEEZY_API_KEY) {
  throw new Error('LEMONSQUEEZY_API_KEY is not set. See .env.example.');
}

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  onError: (e) => console.error('[ls] sdk error', { code: e.cause ?? 'unknown' }),
});

export { createCheckout };
```

## `app/api/checkout/subscribe/route.ts`

```ts
import { NextResponse } from 'next/server';
import { createCheckout } from '@/lib/payments/lemonsqueezy';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) return new NextResponse(null, { status: 401 });

  const variantId = process.env.LEMONSQUEEZY_PRO_VARIANT_ID!;

  const checkout = await createCheckout(
    process.env.LEMONSQUEEZY_STORE_ID!,
    variantId,
    {
      checkoutData: {
        email: session.user.email,
        name: session.user.name ?? undefined,
        custom: { user_id: session.user.id, plan_id: 'pro' },
      },
      productOptions: {
        redirectUrl: `${process.env.PUBLIC_URL}/billing/success`,
        receiptButtonText: 'Volver a la app',
        receiptLinkUrl: `${process.env.PUBLIC_URL}/account`,
      },
      testMode: process.env.LEMONSQUEEZY_API_KEY!.startsWith('lmnsq_test_'),
    }
  );

  if (checkout.error) {
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }

  return NextResponse.json({ url: checkout.data?.data?.attributes?.url });
}
```

## `app/api/webhook/lemonsqueezy/route.ts`

```ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs'; // Rule 5

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) return new NextResponse(null, { status: 413 }); // Rule 10

  const signature = request.headers.get('x-signature');
  if (!signature) return new NextResponse(null, { status: 400 });

  const rawBody = await request.text(); // Rule 5

  if (!verifyLemonSignature(rawBody, signature, process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)) { // Rule 3
    return new NextResponse(null, { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new NextResponse(null, { status: 400 }); }

  // Rule 9 MANDATORY — LS has no timestamp signature
  const eventId =
    event.meta?.event_id ?? crypto.createHash('sha256').update(rawBody).digest('hex');
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: `ls:${eventId}`,
        provider: 'lemonsqueezy',
        event_type: event.meta?.event_name ?? 'unknown',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log('[ls.webhook]', { event: event.meta?.event_name, event_id: eventId, object_id: event.data?.id }); // Rule 6

  try {
    switch (event.meta?.event_name) {
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
        // dunning
        break;
      case 'order_created':
        await handleOrderCreated(event.data, event.meta.custom_data);
        break;
      case 'subscription_payment_refunded':
      case 'order_refunded':
        await handleRefund(event.data);
        break;
      default:
        console.log('[ls.webhook] unhandled', event.meta?.event_name);
    }
  } catch (err: any) {
    console.error('[ls.webhook] handler error', { code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyLemonSignature(rawBody: string, signature: string, secret: string): boolean {
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (computed.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

async function handleSubscriptionCreated(data: any, customData?: any) {
  const attrs = data.attributes;
  const customer = await db.pagokitCustomer.upsert({
    where: { provider_customer_id: String(attrs.customer_id) },
    create: {
      provider: 'lemonsqueezy',
      provider_customer_id: String(attrs.customer_id),
      email: attrs.user_email,
      name: attrs.user_name,
    },
    update: { email: attrs.user_email, name: attrs.user_name },
  });

  await db.pagokitSubscription.upsert({
    where: { provider_subscription_id: String(data.id) },
    create: {
      provider: 'lemonsqueezy',
      provider_subscription_id: String(data.id),
      status: attrs.status,
      customer_id: customer.id,
      plan_id: customData?.plan_id ?? String(attrs.variant_id),
      current_period_end: new Date(attrs.renews_at),
    },
    update: {
      status: attrs.status,
      current_period_end: new Date(attrs.renews_at),
    },
  });

  // Grant entitlements
  if (customData?.user_id) {
    await db.userEntitlement.upsert({
      where: { user_id_plan_id: { user_id: customData.user_id, plan_id: customData.plan_id ?? 'pro' } },
      create: { user_id: customData.user_id, plan_id: customData.plan_id ?? 'pro', source: 'lemonsqueezy' },
      update: {},
    });
  }
}

async function handleSubscriptionUpdated(data: any) {
  const attrs = data.attributes;
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(data.id) },
    data: {
      status: attrs.status,
      plan_id: String(attrs.variant_id),
      current_period_end: new Date(attrs.renews_at),
      cancel_at: attrs.ends_at ? new Date(attrs.ends_at) : null,
    },
  });
}

async function handleSubscriptionCancelled(data: any) {
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(data.id) },
    data: { status: 'cancelled', cancel_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : null },
  });
  // Access stays until ends_at
}

async function handleSubscriptionPaymentSuccess(data: any) {
  const attrs = data.attributes;
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(attrs.subscription_id) },
    data: { current_period_end: new Date(attrs.next_renewal_date ?? attrs.created_at) },
  });
}

async function handleOrderCreated(data: any, customData?: any) {
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: String(data.id) },
    create: {
      provider: 'lemonsqueezy',
      provider_payment_id: String(data.id),
      amount: data.attributes.total,
      currency: data.attributes.currency,
      status: 'succeeded',
      metadata: { user_id: customData?.user_id ?? null },
    },
    update: { status: 'succeeded' },
  });
}

async function handleRefund(data: any) {
  await db.pagokitPayment.update({
    where: { provider_payment_id: String(data.id) },
    data: { status: 'refunded' },
  });
}
```

## `components/SubscribeButton.tsx`

```tsx
'use client';

import { useState } from 'react';

export function SubscribeButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/checkout/subscribe', { method: 'POST' });
    if (!res.ok) { setLoading(false); return; }
    const { url } = await res.json();
    window.location.href = url;
  }

  return <button onClick={handleClick} disabled={loading}>{loading ? 'Procesando…' : 'Suscribirse'}</button>;
}
```

## Webhook events to subscribe in LS dashboard

- `subscription_created`
- `subscription_updated`
- `subscription_cancelled`
- `subscription_payment_success`
- `subscription_payment_failed`
- `subscription_payment_refunded`
- `order_created`
- `order_refunded`

## Install commands

```bash
npm install @lemonsqueezy/lemonsqueezy.js
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ Collecting tax_id / VAT yourself. LS handles it as MoR.
- ❌ Skipping event-id dedup — LS doesn't sign timestamps; this is the only replay defense.
- ❌ Revoking access on `subscription_cancelled` immediately — wait until `ends_at`.
- ❌ Granting entitlements on the success page; use the webhook.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
