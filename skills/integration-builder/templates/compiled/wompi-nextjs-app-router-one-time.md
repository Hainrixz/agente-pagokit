# Compiled — Wompi × Next.js App Router × One-time

Pre-composed for Colombia e-commerce. Uses the Widget for client-side tokenization; server pre-creates the payment row and reconciles via `transaction.updated` webhook.

**Spec match:**
- provider: `wompi`
- stack: `nextjs-app-router`
- billing_mode: `one_time` (Wompi has no native subscriptions)
- frontend_style: `widget`

**Composes:** `wompi/{reference, one-time, webhook, errors, frontend-widget}.md` + `_stack-adapters/nextjs-app-router.md`.

---

## Files generated

```
lib/payments/wompi.ts                       # API base URL helper
lib/payments/errors-wompi.ts
app/api/checkout/wompi/init/route.ts        # POST — generate reference + integrity signature
app/api/webhook/wompi/route.ts              # POST — verify checksum
app/checkout/wompi/return/page.tsx          # return page (don't grant access here)
components/WompiCheckoutButton.tsx          # loads widget.js, opens modal
prisma/schema.prisma
.env.example
```

## `.env.example`

```
WOMPI_PUBLIC_KEY=pub_test_REPLACE_ME
WOMPI_PRIVATE_KEY=prv_test_REPLACE_ME
WOMPI_EVENTS_SECRET=REPLACE_ME
WOMPI_INTEGRITY_SECRET=REPLACE_ME
PUBLIC_URL=http://localhost:3000
```

## `lib/payments/wompi.ts`

```ts
if (!process.env.WOMPI_PRIVATE_KEY) throw new Error('WOMPI_PRIVATE_KEY is not set.');
if (!process.env.WOMPI_PUBLIC_KEY) throw new Error('WOMPI_PUBLIC_KEY is not set.');

export const WOMPI_API_BASE =
  process.env.WOMPI_PRIVATE_KEY!.startsWith('prv_prod_')
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';

export async function wompiFetch(path: string, init?: RequestInit) {
  return fetch(`${WOMPI_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${process.env.WOMPI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}
```

## `app/api/checkout/wompi/init/route.ts`

```ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { productId, quantity = 1 } = await request.json();

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  if (product.currency !== 'COP') return NextResponse.json({ error: 'currency_unsupported' }, { status: 400 });

  const reference = `order_${product.id}_${randomUUID()}`; // Rule 4
  const amountInCents = Math.round(product.price * quantity * 100);

  const integritySignature = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}COP${process.env.WOMPI_INTEGRITY_SECRET}`)
    .digest('hex');

  await db.pagokitPayment.create({
    data: {
      provider: 'wompi',
      provider_payment_id: reference, // replaced by webhook with real tx id
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

## `app/api/webhook/wompi/route.ts`

```ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) return new NextResponse(null, { status: 413 }); // Rule 10

  const rawBody = await request.text(); // Rule 5 (consistency — Wompi's checksum is in-body)
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new NextResponse(null, { status: 400 }); }

  if (!verifyWompiChecksum(event, process.env.WOMPI_EVENTS_SECRET!)) { // Rule 3
    return new NextResponse(null, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.timestamp) > 600) return new NextResponse(null, { status: 400 }); // Rule 9

  const eventDbId = `wompi:${event.data.transaction.id}:${event.timestamp}`;
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: eventDbId,
        provider: 'wompi',
        event_type: event.event,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log('[wompi.webhook]', { event: event.event, tx_id: event.data.transaction.id, tx_status: event.data.transaction.status }); // Rule 6

  try {
    if (event.event === 'transaction.updated') {
      await handleTransactionUpsert(event.data.transaction);
    }
  } catch (err: any) {
    console.error('[wompi.webhook] handler error', { code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyWompiChecksum(event: any, secret: string): boolean {
  if (!event?.signature?.checksum || !event?.timestamp) return false;
  const concatenated = event.signature.properties
    .map((path: string) =>
      path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), event.data)
    )
    .map((v: any) => (v == null ? '' : String(v)))
    .join('');
  const toSign = concatenated + event.timestamp + secret;
  const computed = crypto.createHash('sha256').update(toSign).digest('hex');
  if (computed.length !== event.signature.checksum.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(event.signature.checksum));
}

async function handleTransactionUpsert(tx: any) {
  const existing = await db.pagokitPayment.findFirst({
    where: { provider: 'wompi', metadata: { path: ['reference'], equals: tx.reference } },
  });
  if (existing) {
    await db.pagokitPayment.update({
      where: { id: existing.id },
      data: {
        provider_payment_id: tx.id, // replace temp with real
        status: mapWompiStatus(tx.status),
        metadata: { ...((existing.metadata as any) ?? {}), method: tx.payment_method_type },
      },
    });
  } else {
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

function mapWompiStatus(s: string): string {
  return { APPROVED: 'succeeded', PENDING: 'pending', DECLINED: 'failed', VOIDED: 'refunded', ERROR: 'failed' }[s] ?? 'pending';
}
```

## `components/WompiCheckoutButton.tsx`

```tsx
'use client';
import { useState } from 'react';
import Script from 'next/script';

declare global {
  class WidgetCheckout {
    constructor(options: any);
    open(callback: (result: any) => void): void;
  }
}

export function WompiCheckoutButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch('/api/checkout/wompi/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    const checkout = new WidgetCheckout({
      currency: data.currency,
      amountInCents: data.amountInCents,
      reference: data.reference,
      publicKey: data.publicKey,
      redirectUrl: data.redirectUrl,
      signature: { integrity: data.integritySignature },
    });
    checkout.open((result: any) => {
      const status = result?.transaction?.status;
      window.location.href = `${data.redirectUrl}?status=${status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'pending' : 'failed'}`;
    });
    setLoading(false);
  }

  return (
    <>
      <Script src="https://checkout.wompi.co/widget.js" strategy="afterInteractive" />
      <button onClick={handleClick} disabled={loading}>{loading ? 'Procesando…' : 'Pagar con Wompi'}</button>
    </>
  );
}
```

## Install commands

```bash
npm install
npx prisma migrate dev --name pagokit_init
```

(No SDK install — Wompi has no official Node SDK; we use `fetch` directly.)

## Anti-patterns

- ❌ Implementing card tokenization on the backend — Wompi tokenizes client-side via the Widget.
- ❌ Exposing the private key or integrity secret to the browser.
- ❌ Granting access on `APPROVED` from the Widget callback — wait for the webhook.
- ❌ Treating PENDING as failed (cash vouchers Efecty/Baloto take up to 72h).

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
