# Compiled — Mercado Pago × Next.js App Router × One-time

Pre-composed for LATAM e-commerce on Next.js. Hosted Checkout Pro (Preference) with notification webhook + refund endpoint.

**Spec match:**
- provider: `mercadopago`
- stack: `nextjs-app-router`
- billing_mode: `one_time`
- frontend_style: `hosted`

**Composes:** `mercadopago/{reference, one-time, webhook, refund-endpoint, errors, frontend-hosted}.md` + `_stack-adapters/nextjs-app-router.md`.

---

## Files generated

```
lib/payments/mercadopago.ts                # client, Payment, Preference
lib/payments/errors-mercadopago.ts
app/api/checkout/route.ts                  # creates Preference
app/api/webhook/mercadopago/route.ts       # verifies x-signature
app/api/refund/route.ts                    # auth-checked refund
app/checkout/success/page.tsx
app/checkout/failure/page.tsx
app/checkout/pending/page.tsx              # OXXO / Boleto / cash voucher pending state
components/CheckoutButton.tsx
prisma/schema.prisma
.env.example
```

## `.env.example`

```
MP_ACCESS_TOKEN=TEST-REPLACE-ME-LONG-TOKEN
MP_PUBLIC_KEY=TEST-REPLACE-ME
MP_WEBHOOK_SECRET=REPLACE_ME
NEXT_PUBLIC_MP_PUBLIC_KEY=TEST-REPLACE-ME
NEXT_PUBLIC_MP_ENV=sandbox
PUBLIC_URL=http://localhost:3000
```

## `lib/payments/mercadopago.ts`

```ts
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';

if (!process.env.MP_ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN is not set. See .env.example.');
}

export const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

export const mpPayment = new Payment(mpClient);
export const mpPreference = new Preference(mpClient);
```

## `app/api/checkout/route.ts`

```ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mpPreference } from '@/lib/payments/mercadopago';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { productId, quantity = 1 } = await request.json();

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });

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
    },
    requestOptions: { idempotencyKey },
  });

  return NextResponse.json({
    url: preference.init_point,
    sandbox_url: preference.sandbox_init_point,
  });
}
```

## `app/api/webhook/mercadopago/route.ts`

```ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { mpPayment } from '@/lib/payments/mercadopago';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) return new NextResponse(null, { status: 413 });

  const signature = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  if (!signature || !requestId) return new NextResponse(null, { status: 400 });

  const rawBody = await request.text(); // Rule 5
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return new NextResponse(null, { status: 400 }); }

  if (!verifyMpSignature(signature, requestId, body.data?.id, process.env.MP_WEBHOOK_SECRET!)) {
    return new NextResponse(null, { status: 400 });
  }

  const eventDbId = `mp:${body.type}:${body.id}`;
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: eventDbId,
        provider: 'mercadopago',
        event_type: `${body.type}.${body.action}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log('[mp.webhook]', { type: body.type, action: body.action, data_id: body.data?.id }); // Rule 6

  try {
    if (body.type === 'payment') {
      const payment = await mpPayment.get({ id: body.data.id });
      await handlePaymentUpsert(payment);
    }
  } catch (err: any) {
    console.error('[mp.webhook] handler error', { code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyMpSignature(sig: string, requestId: string, dataId: string, secret: string): boolean {
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const ts = parts['ts']; const v1 = parts['v1'];
  if (!ts || !v1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false; // Rule 9
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (computed.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
}

async function handlePaymentUpsert(payment: any) {
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: String(payment.id) },
    create: {
      provider: 'mercadopago',
      provider_payment_id: String(payment.id),
      amount: Math.round(payment.transaction_amount * 100),
      currency: payment.currency_id,
      status: mapMpStatus(payment.status),
      metadata: { method: payment.payment_method_id, reference: payment.external_reference },
    },
    update: { status: mapMpStatus(payment.status) },
  });
}

function mapMpStatus(s: string): string {
  return { approved: 'succeeded', pending: 'pending', in_process: 'pending',
           rejected: 'failed', cancelled: 'canceled', refunded: 'refunded', charged_back: 'disputed' }[s] ?? 'pending';
}
```

## `components/CheckoutButton.tsx`

```tsx
'use client';
import { useState } from 'react';

export function CheckoutButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    const { url, sandbox_url } = await res.json();
    const target = process.env.NEXT_PUBLIC_MP_ENV === 'production' ? url : sandbox_url;
    window.location.href = target;
  }

  return <button onClick={handleClick} disabled={loading}>{loading ? 'Procesando…' : 'Comprar'}</button>;
}
```

## Webhook URL setup in MP dashboard

After deploying:
1. Go to Mercado Pago developers → Webhooks.
2. Add URL: `https://<your-domain>/api/webhook/mercadopago`.
3. Subscribe to events: `payment` (the only event type MP emits for one-time).
4. Copy the "Webhook secret" → set `MP_WEBHOOK_SECRET`.

## Install commands

```bash
npm install mercadopago
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ Trusting `body.status` from the webhook — always re-fetch via `mpPayment.get(id)`.
- ❌ Hardcoding `init_point` vs `sandbox_init_point` choice. Use `NEXT_PUBLIC_MP_ENV`.
- ❌ Skipping the timestamp window — replay attacks.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
