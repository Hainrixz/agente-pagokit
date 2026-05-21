# Drizzle — DB Adapter

Schema and migration patterns for Drizzle ORM. Same 5 tables as Prisma: `pagokit_payments`, `pagokit_subscriptions`, `pagokit_customers`, `pagokit_idempotency_keys`, `pagokit_webhook_events_processed`.

## Schema extension (Postgres flavor)

Append to or create `drizzle/schema.ts` (read existing first):

```ts
import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---- PagoKit tables ----

export const pagokitCustomers = pgTable(
  'pagokit_customers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    provider: text('provider').notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    email: text('email'),
    name: text('name'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerCustomerIdUnique: uniqueIndex('pagokit_customers_provider_customer_id_unique').on(
      t.provider,
      t.providerCustomerId
    ),
    providerEmailIdx: index('pagokit_customers_provider_email_idx').on(t.provider, t.email),
  })
);

export const pagokitPayments = pgTable(
  'pagokit_payments',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    customerId: text('customer_id').references(() => pagokitCustomers.id),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerPaymentIdUnique: uniqueIndex('pagokit_payments_provider_payment_id_unique').on(
      t.provider,
      t.providerPaymentId
    ),
    providerStatusIdx: index('pagokit_payments_provider_status_idx').on(t.provider, t.status),
    customerIdx: index('pagokit_payments_customer_idx').on(t.customerId),
  })
);

export const pagokitSubscriptions = pgTable(
  'pagokit_subscriptions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    provider: text('provider').notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    status: text('status').notNull(),
    customerId: text('customer_id').notNull().references(() => pagokitCustomers.id),
    planId: text('plan_id'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerSubIdUnique: uniqueIndex('pagokit_subs_provider_sub_id_unique').on(
      t.provider,
      t.providerSubscriptionId
    ),
  })
);

export const pagokitIdempotencyKeys = pgTable(
  'pagokit_idempotency_keys',
  {
    key: text('key').primaryKey(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresIdx: index('pagokit_idempotency_keys_expires_idx').on(t.expiresAt),
  })
);

export const pagokitWebhookEventsProcessed = pgTable(
  'pagokit_webhook_events_processed',
  {
    eventId: text('event_id').primaryKey(),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerReceivedIdx: index('pagokit_webhook_events_provider_received_idx').on(
      t.provider,
      t.receivedAt
    ),
    expiresIdx: index('pagokit_webhook_events_expires_idx').on(t.expiresAt),
  })
);
```

## DB client export (`lib/db.ts`)

PagoKit-generated routes import `db` from `@/lib/db` (Next.js) or `'../lib/db'` (Express). If the file doesn't already exist, generate it:

```ts
// lib/db.ts (Node + Drizzle + node-postgres)
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.');
}

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof drizzle> };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = globalForDb.db ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db;
}
```

## Migration commands

```bash
# Generate the migration SQL
npx drizzle-kit generate

# Apply it
npx drizzle-kit migrate
```

If the user's `drizzle.config.ts` is missing or doesn't point to the schema file, ask them to add:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Query patterns

### Persist an idempotency key

```ts
import { db } from '@/db';
import { pagokitIdempotencyKeys } from './schema';
import { eq } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';

async function checkoutWithIdempotency(input: CheckoutInput) {
  const key = randomUUID(); // Rule 4
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await db.insert(pagokitIdempotencyKeys).values({
      key,
      requestHash,
      expiresAt,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique violation — replay
      const [existing] = await db
        .select()
        .from(pagokitIdempotencyKeys)
        .where(eq(pagokitIdempotencyKeys.key, key));
      if (existing?.response) return existing.response;
    }
    throw err;
  }

  const result = await provider.create({ /* ... */ }, { idempotencyKey: key });

  await db
    .update(pagokitIdempotencyKeys)
    .set({ response: result })
    .where(eq(pagokitIdempotencyKeys.key, key));

  return result;
}
```

### Webhook event dedup

```ts
import { pagokitWebhookEventsProcessed } from './schema';

async function dedupWebhookEvent(eventId: string, provider: string, type: string): Promise<boolean> {
  try {
    await db.insert(pagokitWebhookEventsProcessed).values({
      eventId,
      provider,
      eventType: type,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return false; // not duplicate
  } catch (err: any) {
    if (err.code === '23505') return true;
    throw err;
  }
}
```

## Anti-patterns

- ❌ Using `serial()` for `event_id` — that's the provider's ID, never auto-generate.
- ❌ Skipping `withTimezone: true` on timestamps — Stripe/MP send UTC, conversion bugs ensue.
- ❌ Missing the unique index on `(provider, provider_payment_id)` → silent duplicates from webhook retries.
- ❌ Storing PAN, CVV, or full card data. Only provider tokens. (Rule 12)
