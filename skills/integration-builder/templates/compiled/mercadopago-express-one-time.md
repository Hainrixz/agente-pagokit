# Compiled — Mercado Pago × Express × One-time

Same logic as the Next.js MP one-time combo, adapted to Express. The webhook uses `express.raw` to preserve the raw body for HMAC verification.

**Spec match:**
- provider: `mercadopago`
- stack: `express`
- billing_mode: `one_time`
- frontend_style: hosted (your client app calls these endpoints; MP redirects user)

---

## Files generated

```
src/lib/payments/mercadopago.ts
src/lib/payments/errors-mercadopago.ts
src/routes/checkout.ts                # POST /api/checkout
src/routes/mp-webhook.ts              # POST /api/webhook/mercadopago (express.raw)
src/routes/refund.ts                  # POST /api/refund
src/app.ts                            # middleware ordering
prisma/schema.prisma
.env.example
```

## `src/app.ts`

```ts
import express from 'express';
import mpWebhookRouter from './routes/mp-webhook';
import checkoutRouter from './routes/checkout';
import refundRouter from './routes/refund';

const app = express();

// Webhook router uses express.raw INSIDE the route definition.
// Mount it before global express.json() to be safe.
app.use(mpWebhookRouter);

app.use(express.json({ limit: '1mb' }));

app.use(checkoutRouter);
app.use(refundRouter);

app.listen(Number(process.env.PORT ?? 3000));
```

## `src/routes/mp-webhook.ts`

```ts
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { mpPayment } from '../lib/payments/mercadopago';
import { db } from '../lib/db';

const router = Router();

router.post(
  '/api/webhook/mercadopago',
  express.raw({ type: 'application/json', limit: '256kb' }), // Rule 5 + Rule 10
  async (req, res) => {
    const signature = req.headers['x-signature'] as string | undefined;
    const requestId = req.headers['x-request-id'] as string | undefined;
    if (!signature || !requestId) return res.status(400).send();

    let body: any;
    try { body = JSON.parse(req.body.toString()); } catch { return res.status(400).send(); }

    if (!verifyMpSignature(signature, requestId, body.data?.id, process.env.MP_WEBHOOK_SECRET!)) {
      return res.status(400).send();
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
      return res.json({ received: true, duplicate: true });
    }

    console.log('[mp.webhook]', { type: body.type, action: body.action, data_id: body.data?.id });

    try {
      if (body.type === 'payment') {
        const payment = await mpPayment.get({ id: body.data.id });
        await handlePaymentUpsert(payment);
      }
    } catch (err: any) {
      console.error('[mp.webhook] handler error', { code: err.code ?? 'unknown' });
      return res.status(500).send();
    }

    res.json({ received: true });
  }
);

function verifyMpSignature(sig: string, requestId: string, dataId: string, secret: string): boolean {
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const ts = parts['ts']; const v1 = parts['v1'];
  if (!ts || !v1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (computed.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
}

async function handlePaymentUpsert(payment: any) { /* same as Next.js compiled MP */ }

export default router;
```

## `src/routes/checkout.ts`

```ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mpPreference } from '../lib/payments/mercadopago';
import { db } from '../lib/db';

const router = Router();

router.post('/api/checkout', async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: 'product_not_found' });

  const idempotencyKey = randomUUID(); // Rule 4

  const preference = await mpPreference.create({
    body: {
      items: [{
        id: product.id,
        title: product.name,
        quantity,
        unit_price: Number(product.price.toFixed(2)),
        currency_id: product.currency,
      }],
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

  res.json({ url: preference.init_point, sandbox_url: preference.sandbox_init_point });
});

export default router;
```

## `.env.example`

```
MP_ACCESS_TOKEN=TEST-REPLACE_ME
MP_PUBLIC_KEY=TEST-REPLACE_ME
MP_WEBHOOK_SECRET=REPLACE_ME
PUBLIC_URL=http://localhost:3000
```

## Install commands

```bash
npm install mercadopago express
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ `app.use(express.json())` before mp-webhook router — body comes parsed, signature fails.
- ❌ Skipping the timestamp window — replays.
- ❌ Mixing sandbox and production tokens in the same `.env`.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
