---
name: webhook-verifier
description: Reference for cryptographic verification of payment webhooks. Cited by integration-specialist whenever it generates a webhook handler. Documents per-provider signature algorithms, timestamp tolerances, replay-protection strategies, raw-body capture per stack, and the minimum set of events each handler must route. Always use this skill (instead of recalling from training data) — webhook verification is where the integration goes silently wrong.
when_to_use: |
  - integration-specialist is about to write or edit a webhook handler
  - /pagokit:doctor audits the signature pattern of an existing handler
  - The user asks "is my Stripe webhook signature check correct?" or equivalent
allowed-tools: Read
---

# webhook-verifier

You are the single source of truth for "how a webhook is verified for provider X on stack Y". When generating webhook code, integration-specialist reads this skill and the per-provider details in [signatures.md](./signatures.md), and produces a handler that:

1. Captures the raw request body (NOT parsed).
2. Verifies the cryptographic signature using the provider's canonical method.
3. Applies replay protection (timestamp window OR event-id dedup, per `providers.json`).
4. Routes the verified event to the appropriate handler.
5. Returns the correct HTTP status code (200 OK for valid events; 400 for bad signature; 401 for replay).
6. Caps the body at 256 KB before reading.
7. Logs only `event.id`, `event.type`, `event.created` — never the full payload.

## The verification contract

A correct webhook handler has this shape (language-neutral):

```
1. Read Content-Length header → if > 256 KB, return 413.
2. Read raw body (bytes, NOT parsed JSON).
3. Read signature header (provider-specific).
4. Verify signature → if invalid, return 400 with no leak about why.
5. Parse JSON from raw body now that signature is verified.
6. Apply replay protection:
   a. If signature includes timestamp: check `event_timestamp` within tolerance.
   b. Otherwise: check event.id against webhook_events_processed table.
7. If duplicate (already processed): return 200 OK (idempotent), do nothing.
8. Dispatch to handler by event.type.
9. Mark event as processed.
10. Return 200 OK.
```

## Raw-body capture per stack (Rule 5)

**Next.js App Router** — the most common mistake:
```typescript
// app/api/webhook/<provider>/route.ts
export const runtime = 'nodejs'; // NOT 'edge'

export async function POST(request: Request) {
  const rawBody = await request.text(); // raw string
  const signature = request.headers.get('<signature-header>');
  // pass rawBody (string) to provider's verifier
}
```

**Next.js Pages Router**:
```typescript
// pages/api/webhook/<provider>.ts
export const config = { api: { bodyParser: false } };

import { buffer } from 'micro';

export default async function handler(req, res) {
  const rawBody = await buffer(req); // Buffer
  // pass rawBody.toString() to verifier
}
```

**Express**:
```typescript
// Critical: register raw BEFORE express.json() globally
app.post('/api/webhook/<provider>',
  express.raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const rawBody = req.body; // Buffer because of express.raw
    const signature = req.headers['<signature-header>'];
    // ...
  }
);
```

**FastAPI**:
```python
from fastapi import Request, HTTPException

@app.post("/api/webhook/<provider>")
async def webhook(request: Request):
    if int(request.headers.get("content-length", 0)) > 262_144:
        raise HTTPException(413)
    raw_body = await request.body() # bytes; never .json() before verify
    signature = request.headers.get("<signature-header>")
    # ...
```

**Laravel**:
```php
$rawBody = $request->getContent(); // string
$signature = $request->header('<signature-header>');
```

**Rails**:
```ruby
raw_body = request.raw_post
signature = request.headers['<signature-header>']
```

## Per-provider details

See [signatures.md](./signatures.md) for the full table:
- Signature header name
- Algorithm (HMAC-SHA256, HMAC-SHA256-with-timestamp, SHA-256-checksum)
- Timestamp tolerance in seconds
- Replay mitigation strategy (`timestamp-window` | `event-id-dedup` | `both`)
- Required events minimum (the switch router must handle these or log them as TODO)
- Canonical code snippet calling the provider's verifier

## Error handling

| Situation | Response | Why |
|---|---|---|
| Signature invalid | `400 Bad Request`, body: empty or `{ "error": "invalid_signature" }` | Don't leak why it failed; force attacker to guess. |
| Body > 256 KB | `413 Payload Too Large` | DoS guard. |
| Replay (old timestamp) | `400 Bad Request` | Same as bad signature from the attacker's POV. |
| Duplicate event.id | `200 OK`, no-op | Idempotency: provider may legitimately retry. |
| Handler threw an exception | `500 Internal Server Error` | Provider will retry; check `webhook_events_processed` to dedup the retry. |
| Event type not handled | `200 OK`, log TODO | Avoid being unsubscribed for non-200 responses. |

## The `// @pagokit:signature-verified` tag

The `webhook-has-signature.js` validator detects standard calls (`stripe.webhooks.constructEvent`, `Wompi.verifyEventChecksum`, etc.). If you generate code that wraps verification in a helper from `lib/auth/`, place this tag on the handler function so the validator knows it's covered:

```typescript
// @pagokit:signature-verified -- uses lib/auth/verifyStripeWebhook
export async function POST(request: Request) { … }
```

Bypassing the rule entirely (rare) uses the different `// pagokit-ignore:` syntax — see SECURITY_RULES.md Rule 3.

## Anti-patterns (refuse to generate code that does any of these)

- ❌ `await request.json()` before signature verification — breaks the HMAC.
- ❌ Trusting `event.type` from the parsed JSON before verifying.
- ❌ Storing webhook secrets in `process.env` without checking `.env` is gitignored.
- ❌ Returning a non-2xx response to all unhandled events — most providers disable the endpoint after consecutive failures.
- ❌ Logging the full event body to console / Sentry.
- ❌ Verifying with `STRIPE_SECRET_KEY` (the API key) instead of `STRIPE_WEBHOOK_SECRET` (a different secret with `whsec_` prefix).
