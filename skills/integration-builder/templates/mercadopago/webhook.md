# Mercado Pago — Webhook Template

Verifies `x-signature` HMAC-SHA256 over a templated string, dispatches `payment.created` / `payment.updated`, persists dedup state.

## The signature format

MP sends two headers:

- `x-signature: ts=<unix_seconds>,v1=<hex_hmac>`
- `x-request-id: <uuid>`

The HMAC is computed over the **template string**:

```
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

Where `data.id` is the resource id MP sends in the body. The secret is the dashboard's "Webhook secret".

## Next.js App Router

```ts
// app/api/webhook/mercadopago/route.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { mpPayment } from '@/lib/payments/mercadopago';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface MpWebhookBody {
  type: 'payment' | 'plan' | 'subscription' | 'invoice' | string;
  action: string;
  data: { id: string };
  id: number;
  date_created: string;
  live_mode: boolean;
}

export async function POST(request: Request) {
  // Rule 10: body size guard
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  const signature = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  if (!signature || !requestId) return new NextResponse(null, { status: 400 });

  // Rule 5: raw body for HMAC (parse only after verification)
  const rawBody = await request.text();
  let body: MpWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 3: verify signature
  if (!verifyMpSignature(signature, requestId, body.data.id, process.env.MP_WEBHOOK_SECRET!)) {
    return new NextResponse(null, { status: 400 });
  }

  // Rule 9: dedup by event id (MP retries can repeat)
  const eventDbId = `${body.type}:${body.id}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await db.pagokitWebhookEventProcessed.create({
      data: {
        event_id: eventDbId,
        provider: 'mercadopago',
        event_type: `${body.type}.${body.action}`,
        expires_at: expiresAt,
      },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Rule 6: log metadata only
  console.log('[mercadopago.webhook]', {
    type: body.type,
    action: body.action,
    data_id: body.data.id,
  });

  try {
    if (body.type === 'payment') {
      // Fetch the full payment (the webhook only sends the id)
      const payment = await mpPayment.get({ id: body.data.id });
      await handlePaymentUpsert(payment);
    } else {
      console.log('[mercadopago.webhook] unhandled type', body.type);
    }
  } catch (err: any) {
    console.error('[mercadopago.webhook] handler error', { error_code: err.code ?? 'unknown' });
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function verifyMpSignature(signatureHeader: string, requestId: string, dataId: string, secret: string): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  // Rule 9: timestamp window — reject anything older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  // Constant-time compare
  if (computed.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
}

async function handlePaymentUpsert(payment: any) {
  await db.pagokitPayment.upsert({
    where: { provider_payment_id: String(payment.id) },
    create: {
      provider: 'mercadopago',
      provider_payment_id: String(payment.id),
      amount: Math.round(payment.transaction_amount * 100), // store cents-like normalization
      currency: payment.currency_id,
      status: mapMpStatus(payment.status),
      metadata: {
        method: payment.payment_method_id,
        payer_email: payment.payer?.email, // Rule 11: only email, no full payer object
      },
    },
    update: {
      status: mapMpStatus(payment.status),
    },
  });
}

function mapMpStatus(mpStatus: string): string {
  switch (mpStatus) {
    case 'approved': return 'succeeded';
    case 'pending': return 'pending';
    case 'in_process': return 'pending';
    case 'rejected': return 'failed';
    case 'cancelled': return 'canceled';
    case 'refunded': return 'refunded';
    case 'charged_back': return 'disputed';
    default: return 'pending';
  }
}
```

## Express

Same shape as Next.js but inside an Express handler with `express.raw({ type: 'application/json', limit: '256kb' })`. See `templates/_stack-adapters/express.md` for the middleware ordering.

## Required events minimum

From `providers.json.mercadopago.webhook.required_events_minimum`:

- `payment.created`
- `payment.updated`

MP sends the payment id in the body — your handler MUST `mpPayment.get(id)` to fetch the full payment object. Do NOT trust the webhook body fields beyond `id` because MP's webhook payload is minimal and can lag the real state.

## Anti-patterns

- ❌ Trusting `body.status` or `body.amount` from the webhook payload. Always re-fetch via `mpPayment.get(id)`.
- ❌ Skipping the timestamp window check — MP webhooks can be replayed.
- ❌ Using `crypto.createHmac('sha256', secret).update(rawBody)` — wrong template. MP doesn't sign the body, it signs the manifest string `id:...;request-id:...;ts:...;`.
- ❌ Comparing the HMAC with `===` instead of `timingSafeEqual` — timing attack vector.
- ❌ Returning 4xx for unknown `body.type` — MP retries until 2xx; if unhandled, log and return 200.

## Security rules cited

- Rule 3: signature verification with the manifest template.
- Rule 5: raw body before parse.
- Rule 6: log metadata only.
- Rule 9: timestamp window + event-id dedup.
- Rule 10: body size cap.
- Rule 11: only payer email in metadata.
