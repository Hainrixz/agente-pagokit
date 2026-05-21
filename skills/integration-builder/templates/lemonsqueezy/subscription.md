# Lemon Squeezy — Subscription Template

Subscriptions in LS are created via the same `createCheckout` flow — the variant is configured as a subscription in the dashboard, and LS handles the recurring billing transparently.

## Setup in the dashboard

1. Create a product.
2. Create a variant of type **"Subscription"**.
3. Set interval (monthly / yearly), price, trial period (optional).
4. Note the variant ID.

## Subscription checkout endpoint

The endpoint is identical to one-time — just point to a subscription variant:

```ts
// app/api/checkout/subscribe/route.ts
import { NextResponse } from 'next/server';
import { createCheckout } from '@/lib/payments/lemonsqueezy';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { planId } = await request.json();
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan?.lemonsqueezy_variant_id) {
    return NextResponse.json({ error: 'plan_not_found' }, { status: 404 });
  }

  const checkout = await createCheckout(
    process.env.LEMONSQUEEZY_STORE_ID!,
    plan.lemonsqueezy_variant_id,
    {
      checkoutData: {
        email: session.user.email ?? undefined,
        custom: { user_id: session.user.id, plan_id: plan.id },
      },
      productOptions: {
        redirectUrl: `${process.env.PUBLIC_URL}/billing/success`,
      },
      testMode: process.env.LEMONSQUEEZY_API_KEY!.startsWith('lmnsq_test_'),
    }
  );

  return NextResponse.json({ url: checkout.data?.data?.attributes?.url });
}
```

## Webhook lifecycle for subscriptions

The handler in `webhook.md` already routes these events. Implement each:

### `subscription_created` — initial activation

```ts
async function handleSubscriptionCreated(data: any, customData?: Record<string, any>) {
  const attrs = data.attributes;
  const userId = customData?.user_id;
  const planId = customData?.plan_id;

  // Upsert customer first
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
      plan_id: planId ?? String(attrs.variant_id),
      current_period_start: new Date(attrs.renews_at), // LS uses renews_at as end of current
      current_period_end: new Date(attrs.renews_at),
    },
    update: {
      status: attrs.status,
      current_period_end: new Date(attrs.renews_at),
    },
  });

  // Grant entitlements
  if (userId && planId) {
    await db.userEntitlement.upsert({
      where: { user_id_plan_id: { user_id: userId, plan_id: planId } },
      create: { user_id: userId, plan_id: planId, source: 'lemonsqueezy' },
      update: {},
    });
  }
}
```

### `subscription_updated` — plan changes, status transitions

```ts
async function handleSubscriptionUpdated(data: any) {
  const attrs = data.attributes;
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(data.id) },
    data: {
      status: attrs.status, // 'active' | 'on_trial' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired'
      plan_id: String(attrs.variant_id),
      current_period_end: new Date(attrs.renews_at),
      cancel_at: attrs.ends_at ? new Date(attrs.ends_at) : null,
    },
  });

  if (attrs.status === 'past_due' || attrs.status === 'unpaid') {
    // Dunning — LS retries automatically; consider sending your own branded email
  }
}
```

### `subscription_cancelled` — user cancels (active until period end by default)

```ts
async function handleSubscriptionCancelled(data: any) {
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(data.id) },
    data: {
      status: 'cancelled',
      cancel_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : null,
    },
  });
  // Don't revoke entitlements yet — user keeps access until ends_at.
}
```

### `subscription_payment_success` — successful renewal

```ts
async function handleSubscriptionPaymentSuccess(data: any) {
  // LS emits this after every successful charge; usually paired with order_created.
  // Update the next renewal date.
  const attrs = data.attributes;
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(attrs.subscription_id) },
    data: { current_period_end: new Date(attrs.next_renewal_date ?? attrs.created_at) },
  });
}
```

### `subscription_payment_failed` — renewal failed

```ts
async function handleSubscriptionPaymentFailed(data: any) {
  await db.pagokitSubscription.update({
    where: { provider_subscription_id: String(data.attributes.subscription_id) },
    data: { status: 'past_due' },
  });
  // LS auto-retries 3 times over 14 days. After that, status becomes 'unpaid' or 'expired'.
  // Send your own dunning email.
}
```

## Customer portal (LS-hosted)

LS provides a hosted customer portal where users can update card, cancel, view invoices. Get the URL via the subscription object:

```ts
// app/api/portal/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const userId = /* from auth */;
  const sub = await db.pagokitSubscription.findFirst({
    where: { provider: 'lemonsqueezy', customer_id_user: userId, status: { in: ['active', 'past_due', 'on_trial'] } },
  });
  if (!sub) return NextResponse.json({ error: 'no_subscription' }, { status: 404 });

  // The portal URL is included in the subscription object from LS (attribute: urls.customer_portal)
  // Re-fetch if not cached:
  const portalUrl = sub.metadata?.customer_portal_url;
  if (!portalUrl) {
    // Fetch via LS API: getSubscription(subId) and read .attributes.urls.customer_portal
  }

  return NextResponse.json({ url: portalUrl });
}
```

Store the customer portal URL on the subscription row when you first receive `subscription_created` (it's in `data.attributes.urls.customer_portal`).

## Plan switching

LS supports upgrading/downgrading via the API: `updateSubscription(subId, { variantId: newVariantId })`. Proration is automatic per LS's policy.

## Trial periods

Configured in the variant (Dashboard). When a trial is in effect, `subscription.status === 'on_trial'`. Treat it as active for entitlements.

## Anti-patterns

- ❌ Granting entitlements based on `attributes.status === 'active'` only — `on_trial` is also active access.
- ❌ Revoking access immediately on `subscription_cancelled`. Wait until `ends_at` (LS allows access through paid period).
- ❌ Building your own dunning emails before reading LS's default ones — duplicate notifications.
- ❌ Implementing pause/resume yourself. LS does it via the portal.

## Security rules cited

- Rule 11: only email + name from session passed to LS.
