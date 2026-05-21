# Webhook Signatures — Per-Provider Reference

For each provider, this file documents:

1. Signature header name
2. Algorithm
3. Replay mitigation
4. Required events minimum
5. Canonical verification code (Node + Python)
6. Anti-patterns specific to this provider

---

## Stripe

- **Signature header:** `Stripe-Signature`
- **Algorithm:** HMAC-SHA256 over `<timestamp>.<raw_body>`, included in the header as `t=<timestamp>,v1=<signature>`.
- **Timestamp tolerance:** 300 seconds (5 minutes).
- **Replay mitigation:** `timestamp-window` (the tolerance check is sufficient because timestamps are signed).
- **Webhook secret env var:** `STRIPE_WEBHOOK_SECRET` (prefix `whsec_`). **Different from `STRIPE_SECRET_KEY`.**

**Required events minimum (must be routed in the switch):**
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `invoice.payment_failed` (subscriptions)
- `customer.subscription.deleted`
- `customer.subscription.updated`

**Canonical Node verification:**

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil', // pin explicitly
});

// inside the handler, after reading rawBody:
let event: Stripe.Event;
try {
  event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
} catch (err) {
  return new Response(null, { status: 400 });
}
```

**Canonical Python (FastAPI) verification:**

```python
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
stripe.api_version = "2025-04-30.basil"

try:
    event = stripe.Webhook.construct_event(
        payload=raw_body,
        sig_header=signature,
        secret=os.environ["STRIPE_WEBHOOK_SECRET"],
    )
except (stripe.error.SignatureVerificationError, ValueError):
    raise HTTPException(status_code=400)
```

**Anti-patterns specific to Stripe:**
- Don't pass `request.json()` instead of `rawBody` — the HMAC won't match.
- Don't use Stripe's `Charges API` for new code; use Payment Intents.
- Don't set `stripeAccount` on the verifier — that's for Connect, different model.

---

## Mercado Pago

- **Signature header:** `x-signature` (and supplementary `x-request-id`).
- **Algorithm:** HMAC-SHA256 over `id:<data.id>;request-id:<request-id>;ts:<ts>;` (template specific to MP).
- **Timestamp tolerance:** 300 seconds.
- **Replay mitigation:** `both` (timestamp window + event.id dedup recommended, since MP retries can repeat).
- **Webhook secret env var:** `MP_WEBHOOK_SECRET` (obtained from the Mercado Pago dashboard when configuring the notification URL).

**Required events minimum:**
- `payment.created`
- `payment.updated`

**Canonical Node verification:**

```typescript
import crypto from 'node:crypto';

function verifyMercadoPagoSignature(
  rawBody: string,
  signatureHeader: string,
  requestId: string,
  dataId: string,
  secret: string
): boolean {
  // x-signature header looks like: "ts=1700000000,v1=abcd1234..."
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  // Reject if timestamp older than 5 min
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false;

  // Recompose the string MP signs
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
}
```

**Anti-patterns specific to Mercado Pago:**
- Sandbox keys may not behave identically by country — always test against your target country's sandbox.
- Don't omit the `X-Idempotency-Key` header on `POST /v1/payments` — duplicate charges are common in production retries.
- The webhook URL must NOT have query params in MP dashboard; pass routing via the path.

---

## Wompi

- **Signature header:** `Event-Signature` (in the body as `event.signature.checksum` and `event.signature.properties` on each event).
- **Algorithm:** SHA-256 checksum over the concatenation of selected event properties + timestamp + integrity secret. Wompi sends the list of properties to concatenate; your verifier must rebuild the string in the right order.
- **Timestamp tolerance:** 600 seconds (10 minutes) — Wompi is more lenient.
- **Replay mitigation:** `both`. Wompi recommends dedup by `event.id` AND timestamp window.
- **Webhook secret env var:** `WOMPI_EVENTS_SECRET` (the *events* secret, not the integrity secret used for client-side signing).

**Required events minimum:**
- `transaction.updated`

**Canonical Node verification:**

```typescript
import crypto from 'node:crypto';

function verifyWompiEvent(event: any, secret: string): boolean {
  // event.signature.properties is an array of property paths, e.g.
  // ["transaction.id", "transaction.status", "transaction.amount_in_cents"]
  // event.signature.checksum is the expected hex digest
  // event.timestamp is the epoch seconds
  if (!event?.signature?.checksum || !event.timestamp) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(event.timestamp)) > 600) return false;

  const concatenated = event.signature.properties
    .map((path: string) =>
      path.split('.').reduce((acc: any, key: string) => acc?.[key], event)
    )
    .join('');
  const toSign = concatenated + event.timestamp + secret;
  const computed = crypto.createHash('sha256').update(toSign).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(event.signature.checksum)
  );
}
```

**Anti-patterns specific to Wompi:**
- Don't try to verify before parsing the JSON — Wompi's signature is *inside* the body, not a header HMAC.
- Don't expose the private key (`prv_*`) on the frontend.
- Subscriptions are not natively supported — use saved cards + your own scheduler.

---

## Lemon Squeezy

- **Signature header:** `X-Signature`.
- **Algorithm:** HMAC-SHA256 over the raw body, hex-encoded.
- **Timestamp tolerance:** N/A — Lemon Squeezy does **NOT** sign the timestamp.
- **Replay mitigation:** `event-id-dedup` — store `event.meta.event_id` in `webhook_events_processed` with TTL ≥ 24h.
- **Webhook secret env var:** `LEMONSQUEEZY_WEBHOOK_SECRET` (the "signing secret" from the LS dashboard).

**Required events minimum:**
- `order_created`
- `subscription_created`
- `subscription_updated`
- `subscription_cancelled`
- `subscription_payment_failed`
- `subscription_payment_refunded`

**Canonical Node verification:**

```typescript
import crypto from 'node:crypto';

function verifyLemonSqueezySignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  if (computed.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature)
  );
}
```

After verifying, parse and dedup:

```typescript
const event = JSON.parse(rawBody);
const eventId = event.meta?.event_id;
if (!eventId) return new Response(null, { status: 400 });

const seen = await db.webhook_events_processed.findUnique({ where: { id: eventId } });
if (seen) return new Response(null, { status: 200 }); // idempotent

await db.webhook_events_processed.create({
  data: { id: eventId, provider: 'lemonsqueezy', received_at: new Date() }
});
```

**Anti-patterns specific to Lemon Squeezy:**
- Without event-id dedup, an attacker who captures a webhook can replay it indefinitely (no timestamp to invalidate).
- Don't try to collect tax IDs yourself — LS as MoR handles VAT/sales tax/GST globally.

---

## Summary table

| Provider | Header | Algo | Timestamp signed | Tolerance | Replay strategy |
|---|---|---|---|---|---|
| Stripe | `Stripe-Signature` | HMAC-SHA256 (t.body) | Yes | 300s | timestamp-window |
| Mercado Pago | `x-signature` + `x-request-id` | HMAC-SHA256 (template) | Yes | 300s | both |
| Wompi | inside `event.signature` | SHA-256 checksum | Yes (in body) | 600s | both |
| Lemon Squeezy | `X-Signature` | HMAC-SHA256 (body) | **No** | N/A | event-id-dedup |
