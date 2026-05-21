<img src="../assets/hero.png" alt="PagoKit — Agente de integración de pagos" />

<div align="center">

**El agente que elige e implementa el método de pago óptimo para tu app — desde tu terminal, con Claude Code.**

[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-E3754C?style=flat-square)](https://docs.claude.com/en/docs/claude-code/plugins)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](../LICENSE)
[![Phase 1](https://img.shields.io/badge/Phase_1-shipped-22c55e?style=flat-square)](#roadmap)
[![Tests](https://img.shields.io/badge/validators-42%2F42_passing-22c55e?style=flat-square)](../hooks/checks/__tests__)
[![CI](https://github.com/Hainrixz/agente-pagokit/actions/workflows/test.yml/badge.svg)](https://github.com/Hainrixz/agente-pagokit/actions/workflows/test.yml)

[`tododeia.com`](https://tododeia.com) · [`@soyenriquerocha`](https://instagram.com/soyenriquerocha) · `enrique@tododeia.com`

🇬🇧 **[Read in English](../README.md)**

</div>

---

## Por qué existe<span style="color:#E3754C">.</span>

Cualquier dev que quiere cobrar en su app pierde días investigando entre 30+ pasarelas (Stripe vs Mercado Pago vs Wompi vs Lemon Squeezy). Cuando logra elegir, la integración suele quedar **insegura** (webhook sin firma, replay attacks, keys hardcodeadas, sin idempotency) e **incompleta** (sin frontend, sin DB schema, sin customer portal).

**PagoKit es un plugin de Claude Code que vive en tu terminal**, analiza tu proyecto, te hace 3 preguntas, y genera una integración vertical-completa: frontend (hosted o embedded) + endpoint checkout + webhook con firma verificada + DB migration + customer portal + refund endpoint + error mapper + tests sandbox + checklist de producción + audit trail.

**100% local.** Cero llamadas extra a APIs externas. Los validators corren como procesos Node.js locales que Claude Code invoca como PostToolUse hooks.

---

## Cómo funciona<span style="color:#E3754C">.</span>

<img src="../assets/how-it-works.png" alt="SCAN → ASK → MATCH → BUILD" />

| Paso | Qué hace | Cómo |
|---|---|---|
| **1. SCAN** | Lee tu `package.json`, `README`, schemas DB, route files | Detecta stack (Next.js / Express / FastAPI / …), deploy (Vercel / Railway / …), ORM, idioma. |
| **2. ASK** | 3 preguntas core (cap a 5 max) | País + compradores · Cobro único o recurrente · Métodos locales (OXXO / PSE / Pix / Bizum / efectivo). |
| **3. MATCH** | Aplica filtros duros + ranking | Si no hay proveedor local, fallback a un MoR cross-border con disclaimer. |
| **4. BUILD** | Subagent `integration-specialist` escribe los archivos | Frontend + checkout + webhook + DB + portal + refund + checklist de producción. |

---

## Instalación<span style="color:#E3754C">.</span>

```bash
# 1. Clona el plugin
git clone https://github.com/Hainrixz/agente-pagokit ~/agente-pagokit

# 2. Desde tu proyecto, lanza Claude Code con el plugin cargado
cd ~/tu-proyecto
claude --plugin-dir ~/agente-pagokit
```

Dentro de Claude Code, ejecuta:

```
/pagokit:start
```

> Requiere **Node.js ≥ 18** y **Claude Code 2.x**. Los validators corren como subprocesos Node locales.

---

## Proveedores en Phase 1<span style="color:#E3754C">.</span>

<img src="../assets/providers.png" alt="Stripe · Mercado Pago · Wompi · Lemon Squeezy" />

| Proveedor | Regiones | Suscripciones | MoR (impuestos) | Métodos locales |
|---|---|---|---|---|
| **Stripe** | US · CA · UK · EU · MX · BR · IN · AU · … | ✓ nativo | — | OXXO · Boleto · Pix · Bizum · SEPA · ACH |
| **Mercado Pago** | AR · BR · CL · CO · MX · PE · UY | ✓ vía PreApproval | — | Pix · OXXO · Boleto · Rapipago · PSE · PagoEfectivo |
| **Wompi** | CO | — (no nativa) | — | PSE · Nequi · Bancolombia · Efecty · Baloto |
| **Lemon Squeezy** | Global | ✓ nativo | ✓ VAT/sales tax/GST automatizado | Card · PayPal · Klarna |

**Stacks soportados:** Next.js App Router · Express
**ORMs:** Prisma · Drizzle · SQLAlchemy
**Deploy targets:** Vercel · Railway

Phase 2 agrega Culqi · Niubiz · Conekta · Adyen · Mollie · Klarna · Razorpay · Stripe Connect (marketplaces) · y los stacks NestJS / FastAPI / Django / Flask / Laravel / Rails / Hono.

---

## Seguridad determinística<span style="color:#E3754C">.</span>

<img src="../assets/security.png" alt="Escudo pixel con reglas de seguridad: firma, raw body, idempotency, no keys, gitignore" />

PagoKit enforcea **12 reglas de seguridad**. Las 5 más críticas se validan **determinísticamente** vía hooks `PostToolUse` — no son texto en un markdown, son scripts Node.js que **bloquean writes inseguros** desde Claude:

| Regla | Mecanismo | Qué bloquea |
|---|---|---|
| **1.** Nunca hardcodear API keys | `no-hardcoded-keys.js` | `sk_live_…`, `prv_prod_…`, `APP_USR-…`, `lmnsq_live_…` inline en source |
| **2.** `.env` debe estar en `.gitignore` | `gitignore-check.js` | Crear `.env`/`.env.local` antes de gitignorearlo |
| **3.** Webhooks verifican firma | `webhook-has-signature.js` | Handler sin `constructEvent` / HMAC / equivalente |
| **4.** Idempotency con UUID real | `idempotency-canonical.js` | `Math.random()` o `Date.now()` como idempotency key |
| **5.** Raw body en webhooks | `raw-body.js` | `request.json()` antes de verificar firma (stack-aware) |

Si necesitas saltarte una regla genuinamente:

```ts
// pagokit-ignore: webhook-has-signature -- using custom verifier from lib/auth/payments.ts
```

El bypass se registra en `.pagokit/audit.log` para revisión post-hoc.

Las 7 reglas restantes (replay protection · body size · PII logs · solo test keys · etc.) se enforcean como guías + system-prompt fragments inyectados en el subagent.

---

## Comandos<span style="color:#E3754C">.</span>

| Comando | Qué hace |
|---|---|
| `/pagokit:start` | Wizard completo: analiza, pregunta, recomienda, implementa. |
| `/pagokit:test` | Lanza `stripe listen` o un tunnel y envía eventos sintéticos (firma válida, inválida, replay). |
| `/pagokit:doctor` | Audita una integración existente (env vars, gitignore, prefijo de keys, webhook secret, eventos manejados). |

---

## Lo que se genera en tu proyecto<span style="color:#E3754C">.</span>

Para un proyecto **Stripe + Next.js App Router + Prisma**, PagoKit escribe:

```
app/api/checkout/route.ts             POST /api/checkout · idempotency UUID
app/api/webhook/stripe/route.ts       POST /api/webhook/stripe · firma + replay window
app/api/portal/route.ts               POST /api/portal · billingPortal session
app/api/refund/route.ts               POST /api/refund · auth-checked
components/CheckoutButton.tsx         Trigger frontend (hosted o embedded)
lib/payments/stripe.ts                SDK init · apiVersion pineada
lib/payments/errors.ts                Error mapper cross-provider · ES/EN
lib/db.ts                             Prisma client con globalForPrisma pattern
prisma/schema.prisma                  5 tablas: payments, subscriptions, customers,
                                      idempotency_keys, webhook_events_processed
.env.example                          Solo claves test · sk_test_REPLACE_ME
PAGOKIT_INTEGRATION.md                Audit trail · eventos manejados · próximos pasos
PAGOKIT_PRODUCTION_CHECKLIST.md       Pasos para flip a live (deploy secrets, etc.)
```

Para otros stacks (Express, FastAPI, Laravel, Rails) la estructura se adapta, los principios siguen iguales.

---

## Roadmap<span style="color:#E3754C">.</span>

Phase 2 está enfocada en completar la cobertura LATAM; EU / Asia / Africa / MENA quedan reagrupadas en Phase 3.

| Phase | Estado | Proveedores | Stacks / ORMs |
|---|---|---|---|
| **1. Foundation** | ✅ **Shipped** | Stripe · Mercado Pago · Wompi · Lemon Squeezy → US · CA · MX · CO · AR · BR · CL · PE · UY + EU/UK/AU/IN vía MoR fallback | Next.js App Router · Express · Prisma · Drizzle · SQLAlchemy · Vercel · Railway |
| **2. LATAM core** | ⏳ Next | **Conekta · Culqi · Niubiz · Transbank · Khipu · Pagar.me/PagSeguro · dLocal · EBANX** → MX/PE/CL/BR deep + cross-border LATAM | NestJS · FastAPI |
| **3. Global core** | Planned | **Mollie · Paddle · GoCardless · Adyen · Razorpay · Xendit · Midtrans · Paystack · Flutterwave · Tap · MyFatoorah · Alipay · WeChat Pay · PayPal · Square · Stripe Connect · RevenueCat (mobile IAP) · Coinbase Commerce · Bridge.xyz (stablecoin)** → EU/UK/IN/SEA/Africa/MENA/China/crypto + marketplaces + mobile IAP | Django · Laravel · Rails · Hono · SvelteKit · Astro · Go |
| **4. Marketplace + ops** | Planned | Submission al community marketplace de Anthropic · opt-in telemetry · CI mensual de verificación de versiones · [`docs/COVERAGE.md`](../docs/COVERAGE.md) auto-renderizado | — |

Cobertura completa por país × proveedor: [`skills/payment-advisor/data/regions.json`](../skills/payment-advisor/data/regions.json) → auto-renderizado en [`docs/COVERAGE.md`](../docs/COVERAGE.md).

Historial de releases: [`CHANGELOG.md`](../CHANGELOG.md).

---

## Desarrollo<span style="color:#E3754C">.</span>

```bash
# Instala las devDeps (ajv para JSON Schema)
npm install

# Valida data files contra schemas
npm run validate:data

# Pre-flight completo: validación de data + `claude plugin validate`
npm run validate:plugin

# Corre los 42 tests de validators (4-6 fixtures por check)
npm run test:validators

# Regenera docs/COVERAGE.md desde regions.json + providers.json
npm run generate:coverage

# Wrapper para probar el plugin en un proyecto dummy
./scripts/dev-link.sh /path/al/proyecto-test
```

Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md) para cómo agregar proveedores, stacks o validators.

---

## Seguridad<span style="color:#E3754C">.</span>

¿Encontraste una vulnerabilidad? **No abras un issue público.** Escribe a `security@tododeia.com` o usa [GitHub Security Advisories](https://github.com/Hainrixz/agente-pagokit/security/advisories/new). Respuesta en 48 horas.

Ver [`SECURITY.md`](../SECURITY.md) para la política completa.

---

## Autor<span style="color:#E3754C">.</span>

Hecho por **Enrique Rocha** · [`tododeia.com`](https://tododeia.com)

- Instagram: [`@soyenriquerocha`](https://instagram.com/soyenriquerocha)
- Email: `enrique@tododeia.com`
- Consultoría de IA · agentes · automatizaciones · sprints en Miami

Si te ahorró días de trabajo, mándame un screenshot por DM. Si rompió algo, abre un issue.

---

## Licencia<span style="color:#E3754C">.</span>

[MIT](../LICENSE) · 2026 Enrique Rocha · `tododeia.`
