# Wompi — Webhook Template

Verifies Wompi's "checksum" signature, which is **inside the event body** (not a header HMAC). Dispatches `transaction.updated`, persists dedup state.

## How Wompi's signature works

Each event has a `signature` object inside the body:

```json
{
  "event": "transaction.updated",
  "data": {
    "transaction": {
      "id": "01-1700000000-12345",
      "status": "APPROVED",
      "amount_in_cents": 5000000,
      "currency": "COP",
      "reference": "order_abc_1700000000"
    }
  },
  "environment": "test",
  "signature": {
    "checksum": "<HEX_DIGEST>",
    "properties": [
      "transaction.id",
      "transaction.status",
      "transaction.amount_in_cents"
    ]
  },
  "timestamp": 1700000000,
  "sent_at": "2026-05-20T10:00:00.000Z"
}
```

The checksum is `SHA256(prop1_value + prop2_value + ... + timestamp + WOMPI_EVENTS_SECRET)`, where `propN_value` is the value at the path declared in `properties[]`.

## Next.js App Router

```ts
// app/api/webhook/wompi/route.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface WompiEvent {
  event: string;
  data: { transaction: any };
  environment: 'test' | 'prod';
  signature: { checksum: string; properties: string[] };
  timestamp: number;
  sent_at: string;
}

export async function POST(request: Request) {
  // Rule 10: body size guard
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  // Rule 5: raw body (although Wompi's signature is in-body, we treat it consistently)
  const rawBody = await request.text();
  let event: WompiEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 3: verify checksum
  if (!verifyWompiChecksum(event, process.env.WOMPI_EVENTS_SECRET!)) {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 9: timestamp window (Wompi tolerance per providers.json: 600s)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.timestamp) > 600) {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 9 secondary: dedup by reference + timestamp (Wompi events don't expose a separate id)
  const eventDbId = `wompi:${event.data.transaction.id}:${event.timestamp}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: eventDbId,
        provider: 'wompi',
        event_type: event.event,
        expires_at: expiresAt,
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Rule 6: log metadata only
  console.log('[wompi.webhook]', {
    event: event.event,
    tx_id: event.data.transaction.id,
    tx_status: event.data.transaction.status,
    timestamp: event.timestamp,
  });

  try {
    if (event.event === 'transaction.updated') {
      await handleTransactionUpsert(event.data.transaction);
    } else {
      console.log('[wompi.webhook] unhandled event', event.event);
    }
  } catch (err: any) {
    console.error('[wompi.webhook] handler error', { error_code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyWompiChecksum(event: WompiEvent, secret: string): boolean {
  if (!event?.signature?.checksum || !event?.timestamp) return false;

  const concatenated = event.signature.properties
    .map((path) =>
      path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), event.data)
    )
    .map((v) => (v == null ? '' : String(v)))
    .join('');

  const toSign = concatenated + event.timestamp + secret;
  const computed = crypto.createHash('sha256').update(toSign).digest('hex');

  if (computed.length !== event.signature.checksum.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(event.signature.checksum)
  );
}

async function handleTransactionUpsert(tx: any) {
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: tx.id },
    create: {
      provider: 'wompi',
      provider_payment_id: tx.id,
      amount: tx.amount_in_cents,
      currency: tx.currency,
      status: mapWompiStatus(tx.status),
      metadata: {
        method: tx.payment_method_type,
        reference: tx.reference,
      },
    },
    update: {
      status: mapWompiStatus(tx.status),
    },
  });
}

function mapWompiStatus(wompiStatus: string): string {
  switch (wompiStatus) {
    case 'APPROVED': return 'succeeded';
    case 'PENDING': return 'pending';
    case 'DECLINED': return 'failed';
    case 'VOIDED': return 'refunded';
    case 'ERROR': return 'failed';
    default: return 'pending';
  }
}
```

## Required events minimum

From `providers.json.wompi.webhook.required_events_minimum`:

- `transaction.updated`

That's the only event Wompi emits for one-time payments. For nuzzes (Nequi push notifications, PSE bank-confirmation lag), the same event fires multiple times with different statuses — handler is idempotent via dedup.

## Anti-patterns

- ❌ Treating `event.signature.properties` as a fixed list. Wompi changes the property list per event type; always read it from the payload.
- ❌ Using `crypto.createHmac('sha256', secret)` — Wompi uses `crypto.createHash('sha256')` over `concat + timestamp + secret` (not HMAC).
- ❌ Skipping the timestamp window — replay attacks otherwise.
- ❌ Comparing with `===` instead of `timingSafeEqual`.
- ❌ Treating `PENDING` as failure — cash-voucher transactions sit in PENDING until the customer pays at Efecty/Baloto.

## Security rules cited

- Rule 3: checksum verification.
- Rule 5: raw body (for consistency, though Wompi's checksum is in-body).
- Rule 6: log metadata only.
- Rule 9: timestamp window + event dedup.
- Rule 10: body size cap.
