# Compiled — Stripe × Express × Subscription

Pre-composed for SaaS on Express + Postgres (Prisma or Drizzle). Same logic as the Next.js subscription combo but adapted for Express middleware ordering.

**Spec match:**
- provider: `stripe`
- stack: `express`
- billing_mode: `subscription`
- frontend_style: `hosted` (the frontend is your own React/Vue/etc. app, calling these Express endpoints)

**Composes:** `stripe/{reference, subscription, webhook, customer-portal, refund-endpoint, errors}.md` + `_stack-adapters/express.md`.

---

## Files generated

```
src/lib/payments/stripe.ts                 # SDK init
src/lib/payments/errors.ts                 # error mapper
src/routes/checkout-subscribe.ts           # POST /api/checkout/subscribe
src/routes/portal.ts                       # POST /api/portal
src/routes/refund.ts                       # POST /api/refund
src/routes/stripe-webhook.ts               # POST /api/webhook/stripe (uses express.raw)
src/app.ts                                 # middleware ordering (raw BEFORE json)
prisma/schema.prisma
.env.example
PAGOKIT_INTEGRATION.md
PAGOKIT_PRODUCTION_CHECKLIST.md
```

## `src/app.ts` — middleware ordering is critical

```ts
import express from 'express';
import stripeWebhookRouter from './routes/stripe-webhook';
import checkoutRouter from './routes/checkout-subscribe';
import portalRouter from './routes/portal';
import refundRouter from './routes/refund';

const app = express();

// CRITICAL ORDER: stripe-webhook uses express.raw INTERNALLY for its route only.
// We mount it BEFORE the global express.json() to be safe.
app.use(stripeWebhookRouter);

// Global JSON parser for everything else
app.use(express.json({ limit: '1mb' }));

// Other routes
app.use(checkoutRouter);
app.use(portalRouter);
app.use(refundRouter);

app.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Listening on ${process.env.PORT ?? 3000}`);
});
```

## `src/routes/stripe-webhook.ts`

```ts
import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { stripe } from '../lib/payments/stripe';
import { db } from '../lib/db';

const router = Router();

router.post(
  '/api/webhook/stripe',
  express.raw({ type: 'application/json', limit: '256kb' }), // Rule 5 + Rule 10
  async (req, res) => {
    const signature = req.headers['stripe-signature'] as string | undefined;
    if (!signature) return res.status(400).send();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent( // Rule 3 + Rule 9
        req.body, // Buffer thanks to express.raw
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch {
      return res.status(400).send();
    }

    try {
      await db.pagokitWebhookEventProcessed.create({ // Rule 9
        data: {
          event_id: event.id,
          provider: 'stripe',
          event_type: event.type,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } catch {
      return res.json({ received: true, duplicate: true });
    }

    console.log('[stripe.webhook]', { id: event.id, type: event.type }); // Rule 6

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.payment_failed':
          // dunning
          break;
        case 'invoice.payment_succeeded':
          break;
        case 'charge.refunded':
        case 'charge.dispute.created':
        case 'payment_intent.succeeded':
        case 'payment_intent.payment_failed':
          // handle one-time + lifecycle as in the Next.js compiled subscription file
          break;
        default:
          console.log('[stripe.webhook] unhandled', event.type);
      }
    } catch (err: any) {
      console.error('[stripe.webhook] handler error', { id: event.id, code: err.code ?? 'unknown' });
      return res.status(500).send();
    }

    res.json({ received: true });
  }
);

async function handleSubscriptionUpsert(sub: Stripe.Subscription) { /* same body as Next.js compiled */ }
async function handleSubscriptionDeleted(sub: Stripe.Subscription) { /* same */ }

export default router;
```

## `src/routes/checkout-subscribe.ts`

```ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { stripe } from '../lib/payments/stripe';
import { db } from '../lib/db';
import { requireAuth, type AuthedRequest } from '../middleware/auth';

const router = Router();

router.post('/api/checkout/subscribe', requireAuth, async (req: AuthedRequest, res) => {
  const { priceId } = req.body;
  const idempotencyKey = randomUUID(); // Rule 4

  let customer = await db.pagokitCustomer.findFirst({
    where: { provider: 'stripe', email: req.user.email },
  });
  if (!customer) {
    const sc = await stripe.customers.create({
      email: req.user.email,
      metadata: { user_id: req.user.id },
    });
    customer = await db.pagokitCustomer.create({
      data: { provider: 'stripe', provider_customer_id: sc.id, email: req.user.email },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customer.provider_customer_id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.PUBLIC_URL}/billing/success`,
        cancel_url: `${process.env.PUBLIC_URL}/billing/cancel`,
        allow_promotion_codes: true,
      },
      { idempotencyKey }
    );
    res.json({ url: session.url });
  } catch (err: any) {
    console.error('[checkout] failed', { code: err.code ?? 'unknown' });
    res.status(500).json({ error: 'checkout_failed' });
  }
});

export default router;
```

## `src/routes/portal.ts` + `src/routes/refund.ts`

Identical to the Next.js compiled subscription file but inside Express router handlers with `requireAuth` middleware. See `stripe/customer-portal.md` and `stripe/refund-endpoint.md` for the per-route bodies.

## Install commands

```bash
npm install stripe@^17 express
npx prisma migrate dev --name pagokit_init
```

## Anti-patterns

- ❌ Putting `app.use(express.json())` BEFORE `stripeWebhookRouter` — signature breaks.
- ❌ Forgetting the global `app.use(express.json())` AFTER — every other endpoint stops parsing JSON.
- ❌ Trying to use `express.raw` globally to "be safe" — your other endpoints break.

## Security rules cited

Same as Next.js compiled: 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
