# Next.js App Router — Stack Adapter

Canonical patterns for Next.js 14+ App Router. Cited by every provider template when the user's project is detected as `nextjs-app-router`.

## Webhook route — raw body capture (Rule 5)

```ts
// app/api/webhook/<provider>/route.ts
import { NextResponse } from 'next/server';

// CRITICAL: Force Node.js runtime. Edge runtime breaks crypto for several providers.
export const runtime = 'nodejs';

// CRITICAL: Always read the body as text BEFORE any parsing.
// Signature verification computes HMAC over the exact bytes the provider sent.
export async function POST(request: Request) {
  // Rule 10: body size guard
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 256 * 1024) {
    return new NextResponse(null, { status: 413 });
  }

  const rawBody = await request.text(); // raw string, NOT .json()
  const signature = request.headers.get('<signature-header>');

  if (!signature) {
    return new NextResponse(null, { status: 400 });
  }

  // ... provider-specific verification (see templates/<provider>/webhook.md)
}
```

**Never do this:**

```ts
// ❌ BROKEN — signature will never verify
const body = await request.json();
```

## Checkout route — POST endpoint with idempotency (Rule 4)

```ts
// app/api/checkout/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();
  const idempotencyKey = randomUUID(); // Rule 4: canonical UUID

  // ... call provider SDK with idempotencyKey
  // Persist to idempotency_keys table BEFORE calling provider so retries dedup.

  return NextResponse.json({ url: result.url });
}
```

## Server Action alternative (App Router specific)

If the user's project uses Server Actions for checkout (Next.js 14+), generate the action in `app/actions/checkout.ts`:

```ts
'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';

export async function createCheckout(formData: FormData) {
  const idempotencyKey = randomUUID();
  // ... provider call
  redirect(result.url);
}
```

Server Actions still pair with a webhook route — only the user-facing trigger differs.

## Environment variable access

```ts
// Always non-null assert at usage with explicit error if missing.
const secretKey = process.env.PROVIDER_SECRET_KEY;
if (!secretKey) {
  throw new Error('PROVIDER_SECRET_KEY is not set. See .env.example.');
}
```

Don't use `!` (non-null assertion) without a runtime guard. The user will deploy with the env var missing eventually.

## Anti-patterns

- ❌ `export const runtime = 'edge'` on webhook routes. Edge runtime lacks `node:crypto` in many setups.
- ❌ `await request.json()` in webhook routes. Always `await request.text()`.
- ❌ Calling provider SDK at module top-level (initializes on every request in dev). Lazy-init inside the handler or memoize globally.
- ❌ `new NextResponse(JSON.stringify(...))` — use `NextResponse.json(...)`.
- ❌ Returning the raw provider error to the client (leaks internal info). Map via `lib/payments/errors.ts`.

## Required `package.json` updates

When integration-specialist runs, ensure the package manifest includes:

- `"engines": { "node": ">=18" }`
- Provider SDK pinned (e.g., `"stripe": "^17.0.0"`)

## How this composes with provider templates

For a Stripe + Next.js App Router + one-time integration, the composed file uses:

1. This adapter's webhook structure (raw body, runtime: 'nodejs', body size guard).
2. The provider's `webhook.md` for `stripe.webhooks.constructEvent(...)` and the event router.
3. The DB adapter's idempotency_keys + webhook_events_processed query patterns.

See `templates/compiled/stripe-nextjs-app-router-one-time.md` for the fully composed example.
