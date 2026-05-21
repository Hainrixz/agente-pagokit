# Prisma — DB Adapter

Schema and migration patterns for Prisma 5+. Generates 5 tables: `payments`, `subscriptions`, `customers`, `idempotency_keys`, `webhook_events_processed`.

## Schema extension

Append to existing `prisma/schema.prisma` (read first, do not clobber):

```prisma
// ---- PagoKit tables (do not edit names — the integration depends on them) ----

model PagokitPayment {
  id                  String   @id @default(cuid())
  provider            String   // "stripe" | "mercadopago" | "wompi" | "lemonsqueezy"
  provider_payment_id String   @unique
  amount              Int      // smallest currency unit (cents, centavos)
  currency            String   // ISO 4217 3-letter
  status              String   // "pending" | "succeeded" | "failed" | "refunded" | "disputed"
  customer_id         String?
  metadata            Json?
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt

  customer            PagokitCustomer? @relation(fields: [customer_id], references: [id])
  subscriptions       PagokitSubscription[]

  @@index([provider, status])
  @@index([customer_id])
  @@map("pagokit_payments")
}

model PagokitSubscription {
  id                      String   @id @default(cuid())
  provider                String
  provider_subscription_id String  @unique
  status                  String   // "active" | "past_due" | "canceled" | "trialing" | "incomplete"
  customer_id             String
  plan_id                 String?
  current_period_start    DateTime?
  current_period_end      DateTime?
  cancel_at               DateTime?
  canceled_at             DateTime?
  metadata                Json?
  created_at              DateTime @default(now())
  updated_at              DateTime @updatedAt

  customer                PagokitCustomer @relation(fields: [customer_id], references: [id])
  payments                PagokitPayment[]

  @@index([provider, status])
  @@index([customer_id])
  @@map("pagokit_subscriptions")
}

model PagokitCustomer {
  id                  String   @id @default(cuid())
  provider            String
  provider_customer_id String  @unique
  email               String?
  name                String?
  metadata            Json?
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt

  payments            PagokitPayment[]
  subscriptions       PagokitSubscription[]

  @@index([provider, email])
  @@map("pagokit_customers")
}

model PagokitIdempotencyKey {
  key         String   @id // UUID v4
  request_hash String  // SHA-256 of the canonical request body
  response    Json?
  created_at  DateTime @default(now())
  expires_at  DateTime // TTL 24h

  @@index([expires_at])
  @@map("pagokit_idempotency_keys")
}

model PagokitWebhookEventProcessed {
  event_id    String   @id
  provider    String
  event_type  String
  received_at DateTime @default(now())
  expires_at  DateTime // TTL 24h+ for replay protection

  @@index([provider, received_at])
  @@index([expires_at])
  @@map("pagokit_webhook_events_processed")
}
```

**Why `pagokit_` prefix on table names:** the user's existing schema may already have `payments`, `customers`, `subscriptions` tables for unrelated business logic. The prefix prevents collision and makes PagoKit-managed data explicit.

## DB client export (`lib/db.ts`)

PagoKit-generated routes import `db` from `@/lib/db` (Next.js) or `'../lib/db'` (Express). If the file doesn't already exist, generate it:

```ts
// lib/db.ts (Node + Prisma)
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
```

The `globalForPrisma` pattern prevents connection leaks during Next.js hot-reload in development.

## Migration commands

After modifying `schema.prisma`:

```bash
# Generate the migration SQL (interactive name prompt — use 'pagokit_init' or 'pagokit_v0_1')
npx prisma migrate dev --name pagokit_init

# Regenerate the Prisma client
npx prisma generate
```

If the user is in production:

```bash
npx prisma migrate deploy
```

## Query patterns

### Persist an idempotency key BEFORE calling the provider

```ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

async function checkoutWithIdempotency(input: CheckoutInput) {
  const key = randomUUID(); // Rule 4
  const requestHash = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await prisma.pagokitIdempotencyKey.create({
      data: { key, request_hash: requestHash, expires_at: expiresAt },
    });
  } catch (err) {
    // Unique violation — replay. Return the cached response.
    const existing = await prisma.pagokitIdempotencyKey.findUnique({ where: { key } });
    if (existing?.response) return existing.response;
    throw err;
  }

  // Call provider with `key` as the Idempotency-Key header
  const result = await stripe.paymentIntents.create({ /* ... */ }, { idempotencyKey: key });

  await prisma.pagokitIdempotencyKey.update({
    where: { key },
    data: { response: result as any },
  });

  return result;
}
```

### Deduplicate webhook events (Rule 9 — required for Lemon Squeezy)

```ts
async function handleWebhookEvent(eventId: string, provider: string, type: string) {
  try {
    await prisma.pagokitWebhookEventProcessed.create({
      data: {
        event_id: eventId,
        provider,
        event_type: type,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  } catch (err) {
    // Already processed — return 200 OK without re-processing.
    return { duplicate: true };
  }
  return { duplicate: false };
}
```

## Cleanup job (recommended)

Add a daily cron / scheduled job to expire stale rows:

```ts
await prisma.pagokitIdempotencyKey.deleteMany({
  where: { expires_at: { lt: new Date() } },
});
await prisma.pagokitWebhookEventProcessed.deleteMany({
  where: { expires_at: { lt: new Date() } },
});
```

## Anti-patterns

- ❌ Storing the customer's full card number, CVV, or PAN. Use only provider tokens. (Rule 12)
- ❌ Indexing `metadata` (a Json field) — Postgres can but it's slow; index lifted columns instead.
- ❌ Using `cuid` for `event_id` — that's the provider's id, never overwrite it.
- ❌ Skipping `expires_at` on idempotency_keys → unbounded table growth.
