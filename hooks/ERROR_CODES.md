# PagoKit Validator — Error Codes Reference

Every validator emits structured JSON to stderr when it raises a warning or denies a tool call. This file documents the contract so the LLM can read the message and self-correct.

## Output format

Each result is a single JSON object on a single line in stderr:

```json
{
  "tool": "pagokit-validate",
  "file": "app/api/webhook/stripe/route.ts",
  "rule": "webhook-has-signature",
  "level": "deny" | "warn",
  "code": "ERR_WEBHOOK_NO_SIG",
  "message_en": "Webhook handler does not verify request signature.",
  "message_es": "El handler del webhook no verifica la firma de la petición.",
  "suggested_fix": "..."
}
```

The dispatcher consolidates multiple results, writing one JSON object per line.

## Codes

### `ERR_HARDCODED_KEY` (`no-hardcoded-keys`, deny)

A real-looking API key (Stripe/MP/Wompi/LS pattern) appeared inline in source code. Move it to `.env`.

**Bypass:** `// pagokit-ignore: no-hardcoded-keys -- documented test fixture`

### `ERR_ENV_NOT_GITIGNORED` (`gitignore-check`, deny)

About to write `.env` (or `.env.local`, `.env.production`) but `.gitignore` does not cover it. Add `.env` to `.gitignore` first.

**Allowlisted filenames:** `.env.example`, `.env.sample`, `.env.template`.

### `ERR_WEBHOOK_NO_SIG` (`webhook-has-signature`, deny)

A webhook handler file does not call any known signature verifier. Required for Rule 3.

**Recognized verifiers** (any of these passes the check):
- `stripe.webhooks.constructEvent`
- Function calls matching `/verify\w*Signature/i`, `/verify\w*Checksum/i`, `/verify\w*Webhook/i`
- Imports from `lib/payments/`, `lib/auth/`, `lib/security/` paired with a verifier call
- `crypto.createHmac` followed by `timingSafeEqual` in the same function
- `crypto.createHash('sha256')` followed by `timingSafeEqual` in the same function

**Bypass:** Add `// @pagokit:signature-verified` on the handler function, OR `// pagokit-ignore: webhook-has-signature -- <reason>`.

### `ERR_IDEMPOTENCY_WEAK` (`idempotency-canonical`, deny)

A checkout/refund endpoint passes `idempotencyKey` but uses `Math.random()`, `Date.now()`, or string concatenation as the source. Required for Rule 4.

**Required generators:** `crypto.randomUUID()`, `uuid.uuid4()`, `uuidv4()`, `SecureRandom.uuid`, `randomUUID()` (imported from `node:crypto` or `uuid`).

**Bypass:** `// pagokit-ignore: idempotency-canonical -- <reason>`.

### `ERR_IDEMPOTENCY_MISSING` (`idempotency-canonical`, warn)

A checkout/refund endpoint uses `idempotencyKey` but no canonical UUID call is detected in the same file. The UUID may come from a helper — this is a warning, not a denial.

### `ERR_RAW_BODY_PARSED` (`raw-body`, deny)

A webhook handler calls `request.json()` / `req.body` (after `express.json()`) / `await request.json()` before signature verification. Signature will never match. Required for Rule 5.

**Stack-specific fixes:**
- Next.js App Router: `await request.text()` instead of `await request.json()`.
- Next.js Pages Router: `export const config = { api: { bodyParser: false } }`.
- Express: register `express.raw({ type: 'application/json', limit: '256kb' })` on the route BEFORE `app.use(express.json())`.
- FastAPI: `await request.body()` instead of `await request.json()`.

**Bypass:** `// pagokit-ignore: raw-body -- <reason>`.

### `ERR_PII_LOG` (`no-pii-logs`, warn)

A webhook handler appears to log the entire `event` / `req.body` / `payload` variable. Log only `event.id`, `event.type`, `event.created`. WARN, not DENY — the LLM is asked to adjust; doesn't block.

### `ERR_WEBHOOK_COLLISION` (`existing-webhook-check`, deny)

About to create a webhook handler at a path that collides with an existing webhook (Clerk, Inngest, Resend, etc.). Use namespaced path: `/api/webhook/<provider>/...`.

**Bypass:** `// pagokit-ignore: existing-webhook-check -- <reason>` in the new file's first 5 lines.

## How the LLM should respond to a deny

1. Read the `suggested_fix` from stderr.
2. Locate the offending file/line.
3. Apply the fix (replace the violating pattern).
4. Re-attempt the Write/Edit — the validator re-runs on each tool call.

If the violation is intentional (rare), use the `// pagokit-ignore: <rule>` syntax — the bypass is logged to `.pagokit/audit.log` for post-hoc review.

## Exit codes

- `0` — all checks passed (no stderr emitted, or only warnings).
- `2` — at least one check denied (tool call is blocked).

The dispatcher never exits with other codes; if a check itself errors internally, it logs to stderr but continues without blocking the user.
