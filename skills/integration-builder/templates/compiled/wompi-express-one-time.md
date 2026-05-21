# Compiled — Wompi × Express × One-time

Same logic as the Next.js Wompi combo, adapted to Express. The webhook still parses JSON (Wompi's checksum is inside the body, not a header HMAC over raw bytes — but we still use `express.raw` for consistency and to enforce the body-size limit).

**Spec match:**
- provider: `wompi`
- stack: `express`
- billing_mode: `one_time`
- frontend_style: `widget`

---

## Files generated

```
src/lib/payments/wompi.ts
src/lib/payments/errors-wompi.ts
src/routes/wompi-init.ts                 # POST /api/checkout/wompi/init
src/routes/wompi-webhook.ts              # POST /api/webhook/wompi
src/app.ts
prisma/schema.prisma
.env.example
```

## `src/app.ts`

```ts
import express from 'express';
import wompiWebhookRouter from './routes/wompi-webhook';
import wompiInitRouter from './routes/wompi-init';

const app = express();

// Webhook router uses express.raw INSIDE its route; mount before global json.
app.use(wompiWebhookRouter);

app.use(express.json({ limit: '1mb' }));

app.use(wompiInitRouter);

app.listen(Number(process.env.PORT ?? 3000));
```

## `src/routes/wompi-init.ts`

```ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { db } from '../lib/db';

const router = Router();

router.post('/api/checkout/wompi/init', async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: 'product_not_found' });
  if (product.currency !== 'COP') return res.status(400).json({ error: 'currency_unsupported' });

  const reference = `order_${product.id}_${randomUUID()}`; // Rule 4
  const amountInCents = Math.round(product.price * quantity * 100);

  const integritySignature = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}COP${process.env.WOMPI_INTEGRITY_SECRET}`)
    .digest('hex');

  await db.pagokitPayment.create({
    data: {
      provider: 'wompi',
      provider_payment_id: reference,
      amount: amountInCents,
      currency: 'COP',
      status: 'pending',
      metadata: { reference, product_id: product.id },
    },
  });

  res.json({
    reference,
    amountInCents,
    currency: 'COP',
    integritySignature,
    publicKey: process.env.WOMPI_PUBLIC_KEY,
    redirectUrl: `${process.env.PUBLIC_URL}/checkout/wompi/return`,
  });
});

export default router;
```

## `src/routes/wompi-webhook.ts`

```ts
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { db } from '../lib/db';

const router = Router();

router.post(
  '/api/webhook/wompi',
  express.raw({ type: 'application/json', limit: '256kb' }), // Rule 5 + Rule 10
  async (req, res) => {
    let event: any;
    try { event = JSON.parse(req.body.toString()); } catch { return res.status(400).send(); }

    if (!verifyWompiChecksum(event, process.env.WOMPI_EVENTS_SECRET!)) {
      return res.status(400).send();
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.timestamp) > 600) return res.status(400).send(); // Rule 9

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
      return res.json({ received: true, duplicate: true });
    }

    console.log('[wompi.webhook]', {
      event: event.event,
      tx_id: event.data.transaction.id,
      tx_status: event.data.transaction.status,
    });

    try {
      if (event.event === 'transaction.updated') await handleTransactionUpsert(event.data.transaction);
    } catch (err: any) {
      console.error('[wompi.webhook] handler error', { code: err.code ?? 'unknown' });
      return res.status(500).send();
    }

    res.json({ received: true });
  }
);

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

async function handleTransactionUpsert(tx: any) { /* same as Next.js Wompi compiled */ }

export default router;
```

## `.env.example`

```
WOMPI_PUBLIC_KEY=pub_test_REPLACE_ME
WOMPI_PRIVATE_KEY=prv_test_REPLACE_ME
WOMPI_EVENTS_SECRET=REPLACE_ME
WOMPI_INTEGRITY_SECRET=REPLACE_ME
PUBLIC_URL=http://localhost:3000
```

## Install commands

```bash
npm install express
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ Implementing card tokenization on the backend.
- ❌ Skipping the timestamp window.
- ❌ Treating PENDING as failed.

## Security rules cited

Rules 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
