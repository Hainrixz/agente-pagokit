# Changelog

All notable changes to PagoKit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-21 · Phase 1 shipped

Initial public release. Phase 1 scope is intentionally narrow but verified end-to-end.

### Added

- **4 payment providers** with full templates: Stripe, Mercado Pago, Wompi, Lemon Squeezy.
- **2 stack adapters**: Next.js App Router, Express.
- **3 ORM adapters**: Prisma, Drizzle, SQLAlchemy.
- **2 deploy targets**: Vercel, Railway.
- **8 compiled combos** (provider × stack × billing mode) ready for direct copy-paste.
- **7 deterministic validators** running as PostToolUse hooks:
  - `no-hardcoded-keys` (Rule 1) — blocks `sk_live_*` / `prv_prod_*` / `APP_USR-*` / `lmnsq_live_*` inline.
  - `gitignore-check` (Rule 2) — blocks `.env` creation without `.gitignore` coverage.
  - `webhook-has-signature` (Rule 3) — blocks webhook handlers missing signature verification.
  - `idempotency-canonical` (Rule 4) — blocks `Math.random()` / `Date.now()` as idempotency keys.
  - `raw-body` (Rule 5) — blocks `request.json()` before HMAC verification (Next.js / Express / FastAPI).
  - `no-pii-logs` (Rule 6) — warns on full event/body logging.
  - `existing-webhook-check` (Rule 7) — blocks overwriting Clerk / Inngest / Resend webhook routes.
- **42 validator unit tests** across 7 test files, all passing.
- **3 slash commands**: `/pagokit:start`, `/pagokit:test`, `/pagokit:doctor`.
- **5 skills**: `payment-advisor`, `project-analyzer`, `integration-builder`, `webhook-verifier`, `doctor`.
- **1 subagent**: `integration-specialist` for heavy implementation work.
- **Escape hatch**: `// pagokit-ignore: <rule>` and `// @pagokit:signature-verified` for custom wrappers, logged to `.pagokit/audit.log`.
- **Bilingual output** (EN/ES): the agent auto-detects the user's language from the prompt.
- **HD pixel-art identity** assets matching the `tododeia.` brand.
- **GitHub repo polish**: README primary EN + `docs/README.es.md`, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates (bug / feature / provider-request), PR template, CI workflow (`.github/workflows/test.yml`).

### Verified

- `claude plugin validate .` — manifest passes Claude Code's official validator.
- `claude --plugin-dir` smoke test in a real Next.js project:
  - 3 slash commands + 5 skills discovered.
  - `payment-advisor` recommends Lemon Squeezy for US digital-goods cross-border with real fee calc ($20 ebook → $18.50 net).
  - PostToolUse hook **blocks** insecure webhook write (`ERR_WEBHOOK_NO_SIG` + `ERR_RAW_BODY_PARSED`).
  - PostToolUse hook **allows** canonical webhook write.
- 15 / 15 compiled-template blocks pass the plugin's own validators (meta-audit).

### Known limitations (deferred to Phase 2+)

- `Stop` hook is currently a no-op — session-touched file tracking ships in Phase 2.
- `Edit` / `MultiEdit` validators see only the `new_string` fragment, not the resulting file.
- `stripCommentsAndStrings` utility does not handle regex literals (edge case).
- Next.js Pages Router not yet covered by `raw-body` validator.
- Wompi tokenization-on-backend anti-pattern documented but not validated.

## [Unreleased]

### Changed

- **Roadmap rebalanced.** Phase 2 is now exclusively LATAM core (Conekta · Culqi · Niubiz · Transbank · Khipu · Pagar.me/PagSeguro · dLocal · EBANX). Phase 3 regroups EU + Asia + Africa + MENA + China + crypto + marketplaces + mobile IAP under a single "Global core" header.
- **Stacks/ORMs extracted** to a dedicated column in the roadmap table so the provider narrative isn't diluted.
- Comment for `BO` and `EC` in `regions.json` updated to reflect new phase scope.

### Added

- 9 new LATAM regions in `regions.json`: Costa Rica (CR), Panama (PA), Guatemala (GT), El Salvador (SV), Honduras (HN), Nicaragua (NI), Dominican Republic (DO), Paraguay (PY), Puerto Rico (PR).
- 6 sanctioned regions: Cuba (CU), Russia (RU), Iran (IR), Syria (SY), North Korea (KP), Myanmar (MM) — all with `unsupported: true` and an explicit `reason`.
- `phase` field on each provider in `providers.json` (backfilled to `1` for the 4 shipped providers).
- Optional `unsupported` + `reason` fields in `regions.schema.json`, with `reason` constrained to `sanctions:OFAC | sanctions:multilateral | limited_coverage | other`.
- `scripts/generate-coverage.js` + `npm run generate:coverage`. Renders [`docs/COVERAGE.md`](./docs/COVERAGE.md) from the JSON data files — single source of truth, no markdown drift.
- `docs/COVERAGE.md`: country × provider matrix (19 LATAM · 17 global · 6 unsupported).

### Removed (from roadmap)

- Braintree (rolled into PayPal), Mangopay (redundant with Stripe Connect), Ko-fi (creator-payments, low traction), Yoco (covered by Paystack/Flutterwave in NG/ZA), Flask (covered by FastAPI), .NET, Cloudflare Workers. Open an issue if any of these blocks real adoption.
