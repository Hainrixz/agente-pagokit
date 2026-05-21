# Stripe — Customer Portal Template

Generates `POST /api/portal` to redirect users to Stripe's hosted customer portal, where they can update payment methods, cancel subscriptions, view invoices, and download receipts. Indispensable for any SaaS — without it, "cancel my subscription" is an email to support.

## Pre-requisite: Configure the portal in Stripe Dashboard

The first time you use the portal:

1. Go to Stripe Dashboard → Settings → Billing → Customer portal.
2. Configure: which products users can switch between, cancellation policy (immediate vs end of period), allowed actions (update payment method, view history, invoices, etc.).
3. Save. Stripe creates a default configuration tied to your account.

This step is manual — PagoKit Phase 1 documents it but doesn't automate (Stripe Portal config API exists, but most users want to tweak via dashboard).

## Portal session endpoint — Next.js App Router

```ts
// app/api/portal/route.ts
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // Auth — only the user can manage their own subscription
  const session = await getServerSession();
  if (!session?.user) return new NextResponse(null, { status: 401 });

  // Resolve the user's Stripe customer id
  const customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: session.user.email! },
  });
  if (!customer) {
    return NextResponse.json({ error: 'no_customer_record' }, { status: 404 });
  }

  // Create a one-shot portal session
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customer.provider_customer_id,
    return_url: `${process.env.PUBLIC_URL}/account`,
    // Optional: pre-select a flow
    // flow_data: { type: 'subscription_cancel', subscription_cancel: { subscription: subId } }
  });

  return NextResponse.json({ url: portalSession.url });
}
```

## Frontend trigger

```tsx
// components/ManageBillingButton.tsx
'use client';

import { useState } from 'react';

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const res = await fetch('/api/portal', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      setLoading(false);
      alert('No se pudo abrir el portal de facturación. Intenta de nuevo.');
    }
  }

  return (
    <button onClick={open} disabled={loading}>
      {loading ? 'Abriendo…' : 'Administrar suscripción'}
    </button>
  );
}
```

## Express equivalent

```ts
router.post('/api/portal', requireAuth, async (req, res) => {
  const customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: req.user.email },
  });
  if (!customer) return res.status(404).json({ error: 'no_customer_record' });

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.provider_customer_id,
    return_url: `${process.env.PUBLIC_URL}/account`,
  });

  res.json({ url: session.url });
});
```

## Portal flow types

Stripe supports targeted portal flows via `flow_data`:

```ts
// Send the user directly to cancel a specific subscription
flow_data: {
  type: 'subscription_cancel',
  subscription_cancel: { subscription: subId },
  after_completion: { type: 'redirect', redirect: { return_url: cancelledUrl } },
}

// Or to update the payment method on a subscription
flow_data: {
  type: 'payment_method_update',
}

// Or to switch plans
flow_data: {
  type: 'subscription_update',
  subscription_update: {
    subscription: subId,
    items: [{ id: itemId, price: newPriceId, quantity: 1 }],
  },
}
```

## Idempotency / replays

`billingPortal.sessions.create` does NOT accept an `idempotencyKey` (the session is meant to be short-lived). If the user double-clicks the button, two portal sessions are created — harmless because Stripe expires them after use. No DB write here, so dedup isn't needed.

## Anti-patterns

- ❌ Creating a single long-lived portal session and reusing it. Sessions are intended to be created per click and expire after first navigation.
- ❌ Embedding the portal in an iframe. Stripe blocks iframing for security; the portal must open in a top-level window (full redirect or new tab).
- ❌ Skipping the auth check on this endpoint. Anyone could enumerate `pagokitCustomer` ids and hijack billing.
- ❌ Hardcoding `return_url` to localhost. Use `process.env.PUBLIC_URL` so it works across environments.

## Security rules cited

- Rule 11: minimum PII — only the customer ID, no extra fields.
