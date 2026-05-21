<img src="assets/hero.png" alt="PagoKit — Payment Integration Agent" />

<div align="center">

**The agent that picks and implements the optimal payment method for your app — from your terminal, with Claude Code.**

[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-E3754C?style=flat-square)](https://docs.claude.com/en/docs/claude-code/plugins)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](./LICENSE)
[![Phase 1](https://img.shields.io/badge/Phase_1-shipped-22c55e?style=flat-square)](#roadmap)
[![Tests](https://img.shields.io/badge/validators-42%2F42_passing-22c55e?style=flat-square)](./hooks/checks/__tests__)
[![CI](https://github.com/Hainrixz/agente-pagokit/actions/workflows/test.yml/badge.svg)](https://github.com/Hainrixz/agente-pagokit/actions/workflows/test.yml)

[`tododeia.com`](https://tododeia.com) · [`@soyenriquerocha`](https://instagram.com/soyenriquerocha) · `enrique@tododeia.com`

🇪🇸 **[Leer en español](./docs/README.es.md)**

</div>

---

## Why it exists<span style="color:#E3754C">.</span>

Any dev who wants to charge in their app loses days researching 30+ payment gateways (Stripe vs Mercado Pago vs Wompi vs Lemon Squeezy). When they finally pick one, the integration usually ends up **insecure** (webhook without signature, replay attacks, hardcoded keys, no idempotency) and **incomplete** (no frontend, no DB schema, no customer portal).

**PagoKit is a Claude Code plugin that lives in your terminal**, analyzes your project, asks you 3 questions, and generates a vertical-complete integration: frontend (hosted or embedded) + checkout endpoint + signed webhook + DB migration + customer portal + refund endpoint + error mapper + sandbox tests + production checklist + audit trail.

**100% local.** Zero extra external API calls. The validators run as local Node.js processes that Claude Code invokes as PostToolUse hooks.

---

## How it works<span style="color:#E3754C">.</span>

<img src="assets/how-it-works.png" alt="SCAN → ASK → MATCH → BUILD" />

| Step | What it does | How |
|---|---|---|
| **1. SCAN** | Reads your `package.json`, `README`, DB schema, route files | Detects stack (Next.js / Express / FastAPI / …), deploy target (Vercel / Railway / …), ORM, language. |
| **2. ASK** | 3 core questions (cap at 5 max) | Country + buyers · One-time or recurring · Local methods (OXXO / PSE / Pix / Bizum / cash). |
| **3. MATCH** | Applies hard filters + ranking | If no local provider, falls back to a cross-border MoR with disclaimer. |
| **4. BUILD** | `integration-specialist` subagent writes the files | Frontend + checkout + webhook + DB + portal + refund + production checklist. |

---

## Installation<span style="color:#E3754C">.</span>

```bash
# 1. Clone the plugin
git clone https://github.com/Hainrixz/agente-pagokit ~/agente-pagokit

# 2. From your project, launch Claude Code with the plugin loaded
cd ~/your-project
claude --plugin-dir ~/agente-pagokit
```

Inside Claude Code, run:

```
/pagokit:start
```

> Requires **Node.js ≥ 18** and **Claude Code 2.x**. Validators run as local Node subprocesses.

---

## Phase 1 providers<span style="color:#E3754C">.</span>

<img src="assets/providers.png" alt="Stripe · Mercado Pago · Wompi · Lemon Squeezy" />

| Provider | Regions | Subscriptions | MoR (taxes) | Local methods |
|---|---|---|---|---|
| **Stripe** | US · CA · UK · EU · MX · BR · IN · AU · … | ✓ native | — | OXXO · Boleto · Pix · Bizum · SEPA · ACH |
| **Mercado Pago** | AR · BR · CL · CO · MX · PE · UY | ✓ via PreApproval | — | Pix · OXXO · Boleto · Rapipago · PSE · PagoEfectivo |
| **Wompi** | CO | — (not native) | — | PSE · Nequi · Bancolombia · Efecty · Baloto |
| **Lemon Squeezy** | Global | ✓ native | ✓ VAT/sales tax/GST automated | Card · PayPal · Klarna |

**Supported stacks:** Next.js App Router · Express
**ORMs:** Prisma · Drizzle · SQLAlchemy
**Deploy targets:** Vercel · Railway

Phase 2 adds Culqi · Niubiz · Conekta · Adyen · Mollie · Klarna · Razorpay · Stripe Connect (marketplaces) · and the NestJS / FastAPI / Django / Flask / Laravel / Rails / Hono stacks.

---

## Deterministic security<span style="color:#E3754C">.</span>

<img src="assets/security.png" alt="Pixel shield with security rules: signature, raw body, idempotency, no keys, gitignore" />

PagoKit enforces **12 security rules**. The 5 most critical ones are **deterministically validated** via `PostToolUse` hooks — they aren't text in a markdown, they're Node.js scripts that **block insecure writes** from Claude:

| Rule | Mechanism | What it blocks |
|---|---|---|
| **1.** Never hardcode API keys | `no-hardcoded-keys.js` | `sk_live_…`, `prv_prod_…`, `APP_USR-…`, `lmnsq_live_…` inline in source |
| **2.** `.env` must be in `.gitignore` | `gitignore-check.js` | Creating `.env`/`.env.local` before gitignoring it |
| **3.** Webhooks verify signature | `webhook-has-signature.js` | Handler without `constructEvent` / HMAC / equivalent |
| **4.** Idempotency with real UUID | `idempotency-canonical.js` | `Math.random()` or `Date.now()` as idempotency key |
| **5.** Raw body in webhooks | `raw-body.js` | `request.json()` before verifying signature (stack-aware) |

If you genuinely need to bypass a rule:

```ts
// pagokit-ignore: webhook-has-signature -- using custom verifier from lib/auth/payments.ts
```

The bypass is logged to `.pagokit/audit.log` for post-hoc review.

The 7 remaining rules (replay protection · body size · PII logs · test keys only · etc.) are enforced as guides + system-prompt fragments injected into the subagent.

---

## Commands<span style="color:#E3754C">.</span>

| Command | What it does |
|---|---|
| `/pagokit:start` | Full wizard: analyzes, asks, recommends, implements. |
| `/pagokit:test` | Launches `stripe listen` or a tunnel and sends synthetic events (valid signature, invalid, replay). |
| `/pagokit:doctor` | Audits an existing integration (env vars, gitignore, key prefix, webhook secret, events handled). |

---

## What gets generated in your project<span style="color:#E3754C">.</span>

For a **Stripe + Next.js App Router + Prisma** project, PagoKit writes:

```
app/api/checkout/route.ts             POST /api/checkout · UUID idempotency
app/api/webhook/stripe/route.ts       POST /api/webhook/stripe · signature + replay window
app/api/portal/route.ts               POST /api/portal · billingPortal session
app/api/refund/route.ts               POST /api/refund · auth-checked
components/CheckoutButton.tsx         Frontend trigger (hosted or embedded)
lib/payments/stripe.ts                SDK init · pinned apiVersion
lib/payments/errors.ts                Cross-provider error mapper · ES/EN
lib/db.ts                             Prisma client with globalForPrisma pattern
prisma/schema.prisma                  5 tables: payments, subscriptions, customers,
                                      idempotency_keys, webhook_events_processed
.env.example                          Test keys only · sk_test_REPLACE_ME
PAGOKIT_INTEGRATION.md                Audit trail · events handled · next steps
PAGOKIT_PRODUCTION_CHECKLIST.md       Steps to flip to live (deploy secrets, etc.)
```

For other stacks (Express, FastAPI, Laravel, Rails) the structure adapts; the principles stay the same.

---

## Roadmap<span style="color:#E3754C">.</span>

| Phase | Status | Scope |
|---|---|---|
| **1. Foundation** | ✅ **Shipped** | 4 providers · 2 stacks · 3 ORMs · 7 deterministic validators · 8 compiled combos |
| **2. LATAM + EU + India** | ⏳ Next | Culqi · Niubiz · Conekta · PayU · ePayco · Transbank · Flow · Kushki · PagBrasil · dLocal · EBANX · Adyen · Mollie · Klarna · Razorpay · Paystack · Stripe Connect · NestJS/FastAPI/Django/Laravel/Rails/Hono stacks |
| **3. Global + special cases** | Planned | Square · PayPal · Braintree · Coinbase Commerce · Ko-fi · Tap · Yoco · RevenueCat (iOS/Android IAP) · Adyen for Platforms · Mangopay · .NET/SvelteKit/Astro/Go/Cloudflare Workers stacks |
| **4. Marketplace + observability** | Planned | Submission to Anthropic's community marketplace · opt-in telemetry · monthly CI to refresh provider version pins |

---

## Development<span style="color:#E3754C">.</span>

```bash
# Install devDeps (ajv for JSON Schema)
npm install

# Validate data files against schemas
npm run validate:data

# Run the 42 validator tests (4-6 fixtures per check)
npm run test:validators

# Wrapper to test the plugin in a dummy project
./scripts/dev-link.sh /path/to/test-project
```

**Plugin structure:**

```
agente-pagokit/
├── .claude-plugin/plugin.json          Manifest
├── commands/                           /pagokit:start · :test · :doctor
├── skills/                             5 skills (advisor, analyzer, builder, verifier, doctor)
│   └── integration-builder/templates/  46 templates (per-provider + stack + db + deploy + compiled)
├── agents/integration-specialist.md    Implementer subagent
├── hooks/
│   ├── pagokit-validate.js             Dispatcher
│   ├── checks/                         7 validators + tests
│   └── ERROR_CODES.md                  JSON stderr contract
└── schemas/                            JSON Schemas for data files
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to add providers, stacks, validators.

---

## Security<span style="color:#E3754C">.</span>

Found a vulnerability? Please **don't open a public issue**. Email `security@tododeia.com` or use [GitHub Security Advisories](https://github.com/Hainrixz/agente-pagokit/security/advisories/new). Response within 48 hours.

See [`SECURITY.md`](./SECURITY.md) for the full policy.

---

## Author<span style="color:#E3754C">.</span>

Built by **Enrique Rocha** · [`tododeia.com`](https://tododeia.com)

- Instagram: [`@soyenriquerocha`](https://instagram.com/soyenriquerocha)
- Email: `enrique@tododeia.com`
- AI consulting · agents · automations · sprints in Miami

If it saved you days of work, DM me a screenshot. If it broke something, open an issue.

---

## License<span style="color:#E3754C">.</span>

[MIT](./LICENSE) · 2026 Enrique Rocha · `tododeia.`
