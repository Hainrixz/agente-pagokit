# PagoKit Security Rules

> **Canonical source.** All PagoKit skills, the integration-specialist subagent, and the validator hooks cite these rules by number. Modifying this file changes the contract — bump the plugin minor version.

Rules are tagged with their enforcement mechanism:

- **[VALIDATOR]** — A deterministic Node.js validator runs as a Claude Code hook (Pre/PostToolUse). The LLM cannot bypass it without explicit `// pagokit-ignore: <rule>` comment.
- **[SYSTEM-PROMPT]** — Injected into the integration-specialist subagent's system prompt at every turn. The LLM is reminded continuously.
- **[GUIDE]** — Documented in templates and SKILL.md; relies on the LLM following written instructions.

---

## Rule 1 — Never hardcode API keys [VALIDATOR]

API keys (secret or publishable) must never appear inline in source files. Always reference via `process.env.X` (Node), `os.getenv("X")` (Python), `config('X')` (Laravel), `ENV['X']` (Ruby), etc.

**Why:** Hardcoded keys leak via git history, Slack screenshots, Sentry traces, and IDE plugins. Stripe, Mercado Pago, Lemon Squeezy auto-detect leaked keys on GitHub and revoke them — but only the live ones; test keys live forever and can be used to spam your sandbox.

**Validator:** `hooks/checks/no-hardcoded-keys.js` — loads `secret_key_pattern` and `publishable_key_pattern` from `providers.json` for every active provider; rejects any source file with a literal match.

**How to bypass (rare):** `// pagokit-ignore: no-hardcoded-keys -- this is a documented test fixture, not a real key`

---

## Rule 2 — `.env` must be gitignored before writing any env files [VALIDATOR]

Before the agent creates `.env`, `.env.local`, `.env.example`, or `.env.<environment>`, it must verify the project's `.gitignore` includes `.env` (or a parent glob like `.env*` excluding `.env.example`).

**Why:** A committed `.env` is the #1 cause of leaked production credentials in the wild.

**Validator:** `hooks/checks/gitignore-check.js` — walks up parent directories to find the nearest `.gitignore`. If `.env` is not gitignored, the agent must add it before any env file is written.

**Allowlist:** `.env.example`, `.env.sample`, `.env.template` are exempt — they are meant to be committed and should never contain real secrets.

---

## Rule 3 — Webhook handlers must verify request signature [VALIDATOR + STOP-HOOK]

Every webhook handler must call the provider's signature verification method (or a clearly-named custom wrapper) before parsing the event payload.

**Why:** Without signature verification, an attacker who knows your webhook URL can post forged events — including fake `payment_intent.succeeded` to grant access without paying.

**Validator:** `hooks/checks/webhook-has-signature.js` — for any file matching a provider's `webhook.expected_filenames`, requires one of:

- A call to a known verifier: `stripe.webhooks.constructEvent`, `Wompi.verifyEventChecksum`, `lemonSqueezyVerifyHmac`, equivalent for the target provider.
- An import of a module whose name matches `/webhook|payment|signature|verify/i` AND a call to a function from it.
- An explicit tag comment: `// @pagokit:signature-verified` placed on the handler function (signals a custom verifier the validator can't reflect).

The check also runs at the `Stop` event to catch incremental edits that pass partially.

**How to bypass:** `// pagokit-ignore: webhook-has-signature -- using internal verifier from lib/auth/payments.ts`

---

## Rule 4 — Idempotency keys must be cryptographic UUIDs [VALIDATOR]

Wherever the integration creates an idempotency key (sent to the provider via `Idempotency-Key` header or equivalent), the value must come from:

- Node ≥ 19: `crypto.randomUUID()`
- Older Node: `import { v4 as uuidv4 } from 'uuid'` then `uuidv4()`
- Python: `uuid.uuid4()`
- Ruby: `SecureRandom.uuid`
- PHP: `Ramsey\Uuid\Uuid::uuid4()`
- Go: `uuid.NewString()`

**Never** use `Math.random()`, `Date.now()`, `time.time()`, or string concatenation as the source of an idempotency key.

**Why:** Idempotency keys must be unique and unguessable to prevent (a) accidental double-charges from retries and (b) malicious cross-tenant collisions.

**Validator:** `hooks/checks/idempotency-canonical.js` — for files that send `Idempotency-Key` headers or call provider SDKs with `idempotencyKey` parameter, requires presence of one of the canonical UUID generators in the same file (no cross-file analysis).

Idempotency keys **must also be persisted** on the merchant side. The integration generates a `idempotency_keys` table in the DB migration (see `_db-adapters/*.md`) for deduplication on retry.

---

## Rule 5 — Webhook handlers must consume raw body [VALIDATOR]

Signature verification computes an HMAC (or equivalent) over the *exact bytes* the provider sent. Any pre-parse — `request.json()`, `req.body` after `express.json()`, etc. — breaks verification permanently and silently.

**Stack-specific patterns enforced:**

- Next.js App Router: `await request.text()` then `JSON.parse(rawBody)`. Set `export const runtime = 'nodejs'` (NOT `'edge'`) on the route.
- Next.js Pages Router: `export const config = { api: { bodyParser: false } }` plus a stream reader.
- Express: register `express.raw({ type: 'application/json' })` on the webhook route BEFORE `app.use(express.json())`.
- FastAPI: `await request.body()` returns bytes; never `await request.json()` before verify.
- Laravel: `$request->getContent()` for the raw payload.
- Rails: `request.raw_post`.

**Validator:** `hooks/checks/raw-body.js` — detects the project's stack (parses `package.json`, `requirements.txt`, `composer.json`, `Gemfile`) and rejects the wrong-API call inside any webhook-named file.

---

## Rule 6 — Never log full event payloads [WARN-ONLY]

Webhook handlers must not write `event`, `req.body`, or `payload` to logs (console, structured logger, Sentry breadcrumb). Log only `event.id`, `event.type`, `event.created`. The body contains PII (customer email, billing address, last4 of card) that ends up retained by Datadog / Cloudwatch / Sentry.

**Validator:** `hooks/checks/no-pii-logs.js` — emits a WARNING (not a hard DENY) when it spots `console.log(event)`, `console.log(req.body)`, `print(payload)`. The LLM is asked to adjust; project ships even if it doesn't.

---

## Rule 7 — Never overwrite an existing webhook route [VALIDATOR — PRE]

Before creating a webhook handler file or registering a webhook route, the agent must check whether a webhook endpoint already exists in the project (Clerk, Inngest, Resend, GitHub webhooks, etc.). If it does, the integration must use a namespaced path `/api/webhook/<provider>` and never overwrite the existing one.

**Validator:** `hooks/checks/existing-webhook-check.js` — runs on `PreToolUse` for `Write|Edit|MultiEdit`. Globs filenames AND greps route files (`routes/*`, `urls.py`, `app.*`) for existing webhook registrations. If a collision is detected, the write is blocked and the agent must rename.

**Default convention from Phase 1:** all PagoKit-generated webhooks live under `/api/webhook/<provider>/...`. Multi-provider co-existence is the default, not the exception.

---

## Rule 8 — Setup uses test keys only [SYSTEM-PROMPT + WARN]

On first integration, all generated `.env.example` files contain test-mode keys (prefix detectable from `developer_experience.test_keys_prefix` in `providers.json`). Live keys (`sk_live_`, `prv_prod_`, `APP_USR-`, `lmnsq_live_`) must never appear in `.env.example`.

**System prompt fragment (injected into integration-specialist):**
> "You are generating an initial PagoKit integration. Always set `.env.example` with test-mode keys only. The user transitions to live keys manually via `PAGOKIT_PRODUCTION_CHECKLIST.md` after their first sandbox test passes."

**Validator (warn):** if `.env.example` contains a live-key prefix, emit warning.

---

## Rule 9 — Replay protection: timestamp window or event-id deduplication [GUIDE]

Signature verification alone is **not** enough. An attacker who captures a legitimate webhook can replay it indefinitely unless one of:

- The signature includes a timestamp the verifier rejects when older than the provider's tolerance (Stripe: 5 min, Mercado Pago: 5 min, Wompi: 10 min).
- The handler deduplicates by `event.id`, persisting seen IDs in a store (table `webhook_events_processed` with TTL ≥ 24h).

Each provider's `webhook.replay_mitigation_strategy` in `providers.json` is one of `"timestamp-window"`, `"event-id-dedup"`, `"both"`. The integration-builder picks the right pattern; Lemon Squeezy (no timestamp) MUST use event-id dedup.

---

## Rule 10 — Webhook handlers cap body size [GUIDE]

Reading an unbounded request body invites a slow-loris or memory-exhaustion DoS. Templates set a 256 KB cap on the raw body before signature verification:

- Next.js: check `Content-Length` header; if > 256 KB, return 413 immediately.
- Express: `express.raw({ type: 'application/json', limit: '256kb' })`.
- FastAPI: configure `httpx`/`uvicorn` limits.

Real-world webhook payloads from supported providers are < 64 KB; 256 KB leaves ample headroom.

---

## Rule 11 — Collect the minimum PII; warn on regional regulation [SYSTEM-PROMPT]

The integration collects only the PII required by the chosen flow (typically: email, name, country, billing address if the provider needs it for tax/3DS). It does NOT collect Date of Birth, government IDs, or "extra demographic" fields.

The final report includes a "Legal obligations in your detected region" section citing:
- **EU**: GDPR.
- **Brazil**: LGPD.
- **Mexico**: LFPDPPP.
- **California**: CCPA.
- **Argentina**: PDPA.

Plus invoicing regulations if MoR is not being used: **CFDI 4.0** (Mexico), **NF-e** (Brazil), **OSS** (EU B2C cross-border).

---

## Rule 12 — Never store CVV, full PAN, or magnetic-stripe track data [SYSTEM-PROMPT]

This is the PCI-DSS hard wall. If the user asks the agent to "just save the card number in our DB", the agent **refuses** and cites this rule. Storing PAN puts the merchant in PCI Level 1 scope, which is a 6-figure compliance project. The right pattern:

- Use the provider's tokenization (Stripe customers + payment methods, MP card tokens, Lemon Squeezy uses its own).
- Store only the provider's token (`pm_...`, `card_...`) and the metadata you legitimately need (last4, brand, exp, cardholder name for receipts).

The integration-specialist refuses to write code that:
- Inserts `card_number`, `cvv`, `cvc`, `track1`, `track2`, `expiration_date` columns.
- Logs full card numbers.
- Accepts unmasked card data on a server endpoint (must use provider's PCI-friendly element / widget on the frontend).

---

## How the rules are surfaced to the LLM

1. **payment-advisor SKILL.md** instructs Claude to load this file before recommending a provider, so warnings about KYC, MoR, PCI scope, and regional regulation are mentioned in the output.
2. **integration-specialist agent** has a system prompt fragment listing rules 8, 11, 12 verbatim (the non-validator ones the LLM must self-enforce).
3. **hooks/pagokit-validate.js** loads rules 1–5, 7 as deterministic checks and emits structured stderr (see `hooks/ERROR_CODES.md`).
4. The `// pagokit-ignore: <rule>` escape hatch is documented per rule above and logged to `.pagokit/audit.log` for post-hoc review.
