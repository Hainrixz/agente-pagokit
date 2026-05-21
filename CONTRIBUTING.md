# Contributing to PagoKit

Thanks for considering a contribution. The most valuable contributions today fall into 3 categories:

1. **Adding a new payment provider** (e.g., Culqi, Niubiz, Adyen, Razorpay)
2. **Adding a new stack adapter** (e.g., FastAPI, Laravel, Hono, Rails)
3. **Tightening a validator** (catching a real-world false negative / false positive)

This doc explains how each one works.

---

## Local development setup

```bash
git clone https://github.com/Hainrixz/agente-pagokit
cd agente-pagokit

# Install dev deps (ajv for JSON Schema validation)
npm install

# Run the full sanity suite
npm run validate:data   # JSON Schema + cross-references
npm run test:validators # 42 validator unit tests

# Test the plugin against a real project
./scripts/dev-link.sh /path/to/test-project
```

Inside the test project's Claude Code session, run `/pagokit:start` to exercise the full flow end-to-end.

---

## Adding a new payment provider

A provider needs **4 things** added in one PR:

### 1. Entry in `skills/payment-advisor/data/providers.json`

Required fields (see the JSON Schema at `schemas/providers.schema.json` for the full list):

```json
{
  "id": "your-provider-id",
  "name": "Provider Display Name",
  "last_verified_at": "YYYY-MM-DD",
  "verified_by": "human",
  "status": "active",
  "regions": ["US", "CA", "..."],
  "currencies": ["USD", "..."],
  "methods": ["card", "..."],
  "supports": { "one_time": true, "subscriptions": true, "marketplace_payouts": false, "merchant_of_record": false },
  "fees": { "card_domestic_pct": 2.9, "card_domestic_fixed_usd": 0.30, "notes": "..." },
  "kyc": { "individual_allowed": true, "time_to_activate_days": "1-7" },
  "secret_key_pattern": "^sk_(test|live)_[A-Za-z0-9]{16,}$",
  "developer_experience": { "sdk_quality": 5, "docs_quality": 5, "sandbox": true, "test_keys_prefix": "sk_test_" },
  "webhook": {
    "signature_header": "X-Signature",
    "algorithm": "HMAC-SHA256",
    "signature_includes_timestamp": true,
    "replay_mitigation_strategy": "timestamp-window",
    "expected_filenames": ["webhook", "your-provider-webhook"],
    "required_events_minimum": ["payment.succeeded", "payment.failed", "..."]
  },
  "frontend_options": ["hosted", "embedded"],
  "test_cards": { "success": "...", "decline": "..." },
  "docs_url": "https://docs.your-provider.com",
  "score_modifiers": { "us_saas": 2, "latam_individual_seller": -1 }
}
```

All entries must match the JSON Schema. Run `npm run validate:data` after editing.

### 2. Region(s) in `skills/payment-advisor/data/regions.json`

If your provider operates locally in a country, add it to that country's `primary_providers[]`. If it's a cross-border MoR, add it to `fallback_cross_border_mor[]` for relevant countries.

After editing `regions.json` or `providers.json`, regenerate the coverage page:

```bash
npm run generate:coverage   # writes docs/COVERAGE.md
```

Commit the regenerated `docs/COVERAGE.md` in the same PR. CI will (eventually) fail if it drifts from the data.

### 3. Template directory at `skills/integration-builder/templates/<provider-id>/`

Minimum files:

- `reference.md` — canonical patterns + anti-patterns + SDK init + test cards
- `webhook.md` — full webhook handler code with signature verification (must use `crypto.timingSafeEqual` for comparison)
- `one-time.md` — checkout endpoint with `crypto.randomUUID()` idempotency
- `errors.md` — error code mapping function (matches the cross-provider taxonomy in `lib/payments/errors.ts`)
- `frontend-hosted.md` OR `frontend-embedded.md` OR `frontend-widget.md` (whichever the provider supports)

If the provider supports subscriptions: also add `subscription.md`, `customer-portal.md`, `refund-endpoint.md`.

### 4. Webhook signature entry in `skills/webhook-verifier/signatures.md`

Add a section for your provider with:

- Header name
- Algorithm
- Timestamp signing (yes/no)
- Tolerance window
- Canonical verification code (Node + Python, if both apply)
- Anti-patterns specific to that provider

### Optional but encouraged

- A compiled combo at `skills/integration-builder/templates/compiled/<provider>-<stack>-<billing>.md` for the most common usage of your provider.

### Verifying your provider

After your changes:

```bash
npm run validate:data    # confirm JSON Schema + cross-refs hold
npm run test:validators  # confirm no validator regressions
./scripts/dev-link.sh /path/to/test-project
# Inside Claude Code: /pagokit:start, pick your provider, verify files generated
```

---

## Adding a new stack adapter

A stack adapter is a single file: `skills/integration-builder/templates/_stack-adapters/<stack-name>.md`.

It documents:

1. **Raw-body capture** for webhook handlers (the most critical piece).
2. **Idempotency key generation** with the language's canonical UUID source (`crypto.randomUUID()` for Node, `uuid.uuid4()` for Python, etc.).
3. **Env var access** with a guard pattern.
4. **Error handling** at the framework boundary.
5. **Middleware ordering** if relevant (Express needs `express.raw` before `express.json`).
6. **Anti-patterns** specific to the stack.

Also extend `hooks/checks/raw-body.js` if your stack has a unique raw-body API.

---

## Adding or tightening a validator

Each validator lives in `hooks/checks/<rule-id>.js` and exports a `run(ctx)` function:

```js
function run(ctx) {
  const { filePath, content, toolName, projectDir } = ctx;
  // Returns null (pass) or { rule, level: 'deny' | 'warn', code, message_en, message_es, suggested_fix }
}
```

Tests live in `hooks/checks/__tests__/<rule-id>.test.js` and export an array of cases:

```js
module.exports = [
  { name: '...', check: 'your-rule', ctx: { filePath, content, ... }, expected: 'pass' | 'deny' | 'warn' }
];
```

Minimum **4 fixtures** per rule: valid pass, valid fail, edge case (comment-only / wrapper / fixture), escape-hatch bypass.

Document the new error code in `hooks/ERROR_CODES.md` and register the validator in `hooks/pagokit-validate.js`'s `PHASE_CHECKS` map (pre / post / stop).

Run `npm run test:validators` to confirm.

---

## Code style

- **JavaScript:** plain CommonJS, no transpilation, no external runtime deps for the validators (only `ajv` as a dev dep for schema validation).
- **Templates (`*.md`):** include actual runnable code. The LLM will copy from them — don't leave `// TODO: implement` for security-critical pieces (signature verification, idempotency, raw body).
- **YAML frontmatter:** quote any value containing `|`, `[`, `]`, `:`, or `#`.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `chore:`, `art:`.

---

## Pull request checklist

- [ ] `npm run validate:data` passes.
- [ ] `npm run test:validators` passes (no test removed without justification in the PR description).
- [ ] If you added a provider: `last_verified_at` is today's date and you confirmed fees against the provider's current docs.
- [ ] If you added a template: it cites the relevant `SECURITY_RULES.md` rules by number in code comments (e.g., `// Rule 3: signature verification`).
- [ ] If you changed a validator: existing fixtures still pass + you added new fixtures covering the new behavior.
- [ ] No `sk_live_…` or other real-looking keys committed (use `sk_live_NOTAREALKEYJUSTAFIXTURE…` if needed in test fixtures).

---

## Reporting bugs

Open an issue with the **Bug report** template. Include:

- Provider, stack, billing mode you were using
- Output of `/pagokit:doctor` if applicable
- Relevant file path and which validator (if any) blocked / didn't block
- Claude Code version (`claude --version`)

For security issues, see [`SECURITY.md`](./SECURITY.md).

---

## Maintainer

**Enrique Rocha** · `enrique@tododeia.com` · [`tododeia.com`](https://tododeia.com) · [`@soyenriquerocha`](https://instagram.com/soyenriquerocha)
