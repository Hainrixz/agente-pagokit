---
description: Send synthetic webhook events to a locally running PagoKit integration (valid signature, invalid signature, replay attempt) to verify the handler responds correctly.
argument-hint: "[--provider stripe|mercadopago|wompi|lemonsqueezy] [--port 3000]"
---

You are entering the PagoKit `test` flow. Goal: verify the user's webhook handler behaves correctly under valid events, forged signatures, and replay attempts.

## Phase A — Identify the integration

1. **Read `PAGOKIT_INTEGRATION.md`** from the project root. Extract:
   - Provider (`stripe` | `mercadopago` | `wompi` | `lemonsqueezy`).
   - Webhook path (e.g., `/api/webhook/stripe`).
   - Deploy target — usually `none` when developing locally.

2. **If the file doesn't exist**, ask the user: "No encuentro `PAGOKIT_INTEGRATION.md`. ¿Qué proveedor estás probando, y cuál es la ruta del webhook?".

3. **Detect the dev server port** — read `package.json` scripts for `dev`, `start:dev`, etc. Look for `--port` flags. Defaults: Next.js 3000, Express 3000, FastAPI 8000. Confirm with the user before proceeding if you can't tell.

## Phase B — Phase 1 supports Stripe via `stripe-cli`

For **Stripe** (Phase 1 fully supports this):

1. Check if `stripe` CLI is installed:
   ```bash
   command -v stripe
   ```
   If not, instruct the user:
   - macOS: `brew install stripe/stripe-cli/stripe`
   - Linux: see https://docs.stripe.com/stripe-cli
   - Windows: `scoop install stripe`
   Then stop and ask them to re-run `/pagokit:test`.

2. Check the user is logged in:
   ```bash
   stripe config --list
   ```
   If not, instruct: `stripe login`.

3. Run forwarding in the background (using `run_in_background: true` on the Bash tool):
   ```bash
   stripe listen --forward-to http://localhost:<port><webhook_path>
   ```
   Capture the `whsec_…` it prints — that's the local test webhook secret. Show the user how to put it in `.env.local`:
   > Copia este `whsec_…` a tu `.env.local` como `STRIPE_WEBHOOK_SECRET=...` y reinicia tu servidor.

4. **Send a synthetic event** (only after the user confirms server reload):
   ```bash
   stripe trigger payment_intent.succeeded
   ```
   Watch the `stripe listen` output for `[200]` indicating the handler accepted the event. Report success to the user.

5. **Send an invalid-signature event** (manual test):
   - Use `curl` with a forged signature header. The handler should respond `400`.
   ```bash
   curl -X POST http://localhost:<port><webhook_path> \
     -H "Stripe-Signature: t=1234567890,v1=DEADBEEF" \
     -H "Content-Type: application/json" \
     -d '{"id":"evt_test","type":"payment_intent.succeeded"}' \
     -w "\n%{http_code}\n"
   ```
   Expected: HTTP 400. Report PASS/FAIL.

6. **Send a replay event** (very old timestamp): same as above with `t=1000000000` (year 2001). Expected: HTTP 400. Report PASS/FAIL.

## Phase C — Other providers (Phase 1 limited; expand in Phase 2/3)

For **Mercado Pago**, **Wompi**, **Lemon Squeezy**: their CLIs are limited or non-existent. Fall back to manual tunnel + curl:

1. Ask the user to install `cloudflared` or `ngrok` if not already:
   - `brew install cloudflared` (macOS).
   - Or use ngrok.
2. Start a tunnel: `cloudflared tunnel --url http://localhost:<port>`.
3. The user copies the public HTTPS URL into the provider's webhook config in their dashboard.
4. You generate signed test events using the per-provider crypto code from `webhook-verifier/signatures.md` (you have read-only access to those formulas). Send via `curl`.

For Phase 1, document this clearly and offer to wait — full automation ships in Phase 2/3.

## Output

For each event sent, print a status line:

```
[PASS] Stripe valid event → 200 OK (handler accepted in 87ms)
[PASS] Stripe forged signature → 400 Bad Request
[PASS] Stripe replay (old timestamp) → 400 Bad Request
[INFO] Manual test required for refund — issue a refund from dashboard and watch logs
```

Summary at the end:

```
3 PASS · 0 FAIL · 1 INFO

Webhook handler verified for: payment_intent.succeeded, signature rejection, replay rejection.

Next: run /pagokit:doctor for a full audit (env vars, gitignore, DB schema, missing events).
```

## Anti-patterns

- Do NOT modify the user's `.env.local`. Show them what to paste; let them paste.
- Do NOT keep `stripe listen` running in the foreground — it blocks the shell. Use `run_in_background: true`.
- Do NOT generate a valid signature for a forged event using the user's secret — defeats the purpose of the test.
- Do NOT skip the replay test even if the user wants to wrap up; it's the most common production miss.
