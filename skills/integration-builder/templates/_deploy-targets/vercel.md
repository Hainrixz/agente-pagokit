# Vercel — Deploy Target

Patterns for projects deployed to Vercel. Required when `project-analyzer` detects `vercel.json` or `.vercel/`.

## Environment variables — three scopes

Vercel separates env vars by environment: `development`, `preview`, `production`. PagoKit always uses test keys in `development` and `preview`, live keys only in `production`.

```bash
# Add a test key for development + preview (recommended for dev sharing)
vercel env add STRIPE_SECRET_KEY development
# paste sk_test_...

vercel env add STRIPE_SECRET_KEY preview
# paste sk_test_...

# Add the live key for production (DO NOT confuse with the test key above)
vercel env add STRIPE_SECRET_KEY production
# paste sk_live_... (only when ready to flip the switch)
```

Repeat for every required env var:
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- Mercado Pago: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`
- Wompi: `WOMPI_PRIVATE_KEY`, `WOMPI_PUBLIC_KEY`, `WOMPI_EVENTS_SECRET`
- Lemon Squeezy: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`

## Pull env vars to local

After adding via CLI:

```bash
vercel env pull .env.local
```

This generates `.env.local` (gitignored — Rule 2) with the development-scope values. Don't commit it.

## Function configuration

For webhook routes that need extended timeout (e.g., DB writes on every event), add to `vercel.json`:

```json
{
  "functions": {
    "app/api/webhook/stripe/route.ts": {
      "maxDuration": 30
    }
  }
}
```

Default function timeout on Vercel Hobby is 10s; Pro is 60s; Enterprise can extend further. 30s is typically enough for a single webhook handler unless you're doing heavy DB writes.

## Webhook URL setup in provider dashboard

When the user deploys to Vercel, the production webhook URL is:

- Next.js App Router: `https://<project>.vercel.app/api/webhook/<provider>` (or custom domain)
- Express deployed on Vercel: same path pattern (assuming Express adapter via `@vercel/node`)

The user must:

1. Open the provider's dashboard (Stripe → Developers → Webhooks; MP → Notifications; Wompi → Eventos; LS → Webhooks).
2. Add the production URL as a new endpoint (NOT a domain wildcard — Vercel preview URLs change per deployment).
3. Subscribe to the events in `PAGOKIT_INTEGRATION.md`.
4. Copy the generated webhook secret (`whsec_…` for Stripe, equivalent per provider) and `vercel env add` it as `<PROVIDER>_WEBHOOK_SECRET production`.

For **preview deployments**, optionally configure a separate webhook endpoint with a different `STRIPE_WEBHOOK_SECRET preview` for testing PRs against a sandbox account.

## Edge runtime warning

PagoKit webhook handlers MUST run on the Node.js runtime, not Edge. Vercel respects `export const runtime = 'nodejs'`. Do NOT enable Edge globally via `vercel.json` for webhook routes.

```json
{
  "functions": {
    "app/api/webhook/**/*.ts": {
      "runtime": "nodejs20.x"
    }
  }
}
```

## Cron jobs (for idempotency key cleanup)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/pagokit-cleanup",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Then implement `app/api/cron/pagokit-cleanup/route.ts`:

```ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify the cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  // Delete expired idempotency_keys and webhook_events_processed rows
  // ... use the DB adapter pattern
  return NextResponse.json({ ok: true });
}
```

Add `CRON_SECRET` to your Vercel env vars.

## Anti-patterns

- ❌ Putting `STRIPE_SECRET_KEY=sk_live_...` in `.env` and committing — leak guaranteed. Use `vercel env add`.
- ❌ Using the same webhook secret across `preview` and `production`. Each Vercel environment should have its own webhook endpoint and secret.
- ❌ Enabling Edge runtime globally — webhook handlers will fail signature verification silently.
- ❌ Skipping `maxDuration` configuration for webhook routes that hit Postgres → 10s timeout kills retries.
