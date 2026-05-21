# Express — Stack Adapter

Canonical patterns for Express 4+ / 5+. Cited by every provider template when the user's project is detected as `express`.

## Middleware ordering — critical for webhooks (Rule 5)

```ts
// app.ts or index.ts
import express from 'express';

const app = express();

// CRITICAL: Register the webhook route with express.raw BEFORE app.use(express.json()).
// Once express.json() is active globally, it consumes the body stream and signature
// verification breaks.

app.post(
  '/api/webhook/<provider>',
  express.raw({ type: 'application/json', limit: '256kb' }), // Rule 10: body size cap
  webhookHandler
);

// Then global JSON parser for the rest of the API.
app.use(express.json({ limit: '1mb' }));

app.post('/api/checkout', checkoutHandler);
app.post('/api/portal', portalHandler);
app.post('/api/refund', refundHandler);
```

If you can't change global middleware order, use `express.raw` per-route as shown — the per-route raw parser overrides the global JSON parser for that specific route only.

## Webhook handler shape

```ts
import type { Request, Response } from 'express';

export async function webhookHandler(req: Request, res: Response) {
  const rawBody = req.body as Buffer; // Buffer because of express.raw
  const signature = req.headers['<signature-header>'] as string | undefined;

  if (!signature) {
    return res.status(400).send();
  }

  // ... provider-specific verification (see templates/<provider>/webhook.md)
  // The verifier expects rawBody.toString() or rawBody depending on the SDK.

  res.status(200).send();
}
```

## Checkout handler with idempotency (Rule 4)

```ts
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export async function checkoutHandler(req: Request, res: Response) {
  const { items } = req.body;
  const idempotencyKey = randomUUID(); // Rule 4: canonical UUID

  // ... provider SDK call with idempotencyKey
  // Persist to idempotency_keys table BEFORE calling provider.

  res.json({ url: result.url });
}
```

## Environment variable access

```ts
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

const STRIPE_SECRET_KEY = requireEnv('STRIPE_SECRET_KEY');
```

## Error handler — keep last

```ts
// After all routes:
app.use((err, req, res, next) => {
  // Rule 6: do not log full request body
  console.error('Request failed', {
    path: req.path,
    method: req.method,
    error_code: err.code ?? 'unknown',
  });
  res.status(500).json({ error: 'internal_error' });
});
```

## Anti-patterns

- ❌ `app.use(express.json())` BEFORE the webhook route → signature fails forever.
- ❌ `res.json(error)` returning the raw provider error → leaks internal info.
- ❌ Reading `req.body` as parsed JSON in webhook routes → not raw, breaks HMAC.
- ❌ Missing the `limit: '256kb'` option on `express.raw` → DoS risk.
- ❌ Calling `await provider.something(...)` without try/catch in handlers → unhandled rejection.

## Required `package.json` updates

- `"engines": { "node": ">=18" }`
- Provider SDK pinned
- `@types/express` if TypeScript

## Programmatic route detection (for existing-webhook-check.js validator)

The existing-webhook-check validator parses Express route registrations of the form `app.<verb>('<path>', ...)` and `router.<verb>('<path>', ...)`. If you generate a new webhook route, the validator confirms no collision; if there is one, the route is renamed to `/api/webhook/<provider>` automatically.
