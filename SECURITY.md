# Security Policy

PagoKit generates payment-handling code. We take security reports seriously and respond within **48 hours**.

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security reports.** Use one of these private channels:

- **Email:** `security@tododeia.com` (PGP available on request)
- **GitHub Security Advisories:** [`Hainrixz/agente-pagokit/security/advisories/new`](https://github.com/Hainrixz/agente-pagokit/security/advisories/new)

Include:

1. A description of the issue and its impact.
2. Steps to reproduce (minimal sample project if possible).
3. The affected version (commit SHA or `v*.*.*` tag).
4. Your contact info for follow-up + whether you want public credit.

## Scope

### In scope

- **Validator bypasses** — code that defeats one of the 7 PostToolUse hook validators (`no-hardcoded-keys`, `webhook-has-signature`, `idempotency-canonical`, `raw-body`, `no-pii-logs`, `existing-webhook-check`, `gitignore-check`) without the documented `// pagokit-ignore: <rule>` escape hatch.
- **Insecure templates** — a compiled template or per-provider template in `skills/integration-builder/templates/` that produces code with: missing signature verification, parsed body before HMAC, weak idempotency source, hardcoded secrets, missing replay protection, or PII in logs.
- **Provider data flaws** — incorrect `secret_key_pattern`, missing `expected_filenames`, wrong `replay_mitigation_strategy` in `skills/payment-advisor/data/providers.json` that lead the generator astray.
- **Dispatcher crashes / shell injection** — `hooks/pagokit-validate.js` mishandling stdin payload, env vars, or file paths in a way an attacker could exploit.

### Out of scope

- Issues in **third-party SDKs** (Stripe, Mercado Pago, Wompi, Lemon Squeezy). Report those upstream.
- Issues in **Claude Code itself**. Report to [Anthropic Security](https://www.anthropic.com/responsible-disclosure-policy).
- Test fixtures using clearly-fake key prefixes like `sk_live_NOTAREALKEYJUSTAFIXTURE001` — intentional and documented in `hooks/checks/__tests__/`.
- Theoretical attacks requiring a malicious developer with full local write access (the threat model assumes the developer is the trusted user).

## Coordinated disclosure

We follow a **90-day disclosure** window from confirmed report to public advisory. If you find an actively-exploited issue, we'll prioritize and may publish earlier with credit.

## Hall of fame

Security researchers who responsibly reported issues will be listed here with their consent.

_None yet — be the first!_

## Past advisories

None published.

---

**Maintainer:** Enrique Rocha · `enrique@tododeia.com` · [`tododeia.com`](https://tododeia.com)
