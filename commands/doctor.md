---
description: Audit an existing PagoKit integration — gitignore, env vars, key prefixes, webhook secret, raw body, replay protection, idempotency, DB schema, minimum events handled.
argument-hint: (no arguments)
---

You are entering the PagoKit `doctor` flow. Read-only audit — never write files.

1. **Invoke the `doctor` skill**, which:
   - Reads `PAGOKIT_INTEGRATION.md` from the project root for context (provider, files generated, events routed, ORM, deploy target).
   - If the file is missing, asks the user which provider they're using and proceeds best-effort.
   - Runs each check in the categories defined in the skill: Environment hygiene · Required env vars · Webhook handler quality · Idempotency · DB schema · Production-readiness pointer.
   - Emits a per-check status line `[OK] / [WARN] / [FAIL]`.
   - Produces a summary count and a "Next steps" list.

2. **Report the audit result to the user** verbatim in their language. Format:

   ```
   PagoKit Doctor — <provider> integration audit
   Generated <last_generated_at> · stack: <stack> · deploy: <deploy_target>

   Environment hygiene
     [OK]   .gitignore covers .env
     [OK]   .env not tracked in git
     ...

   Webhook handler
     [OK]   app/api/webhook/stripe/route.ts verifies signature
     [FAIL] customer.subscription.updated not routed
     ...

   (per category)

   Summary: 17 OK · 2 warnings · 1 failure

   Next steps:
   1. Route the missing event customer.subscription.updated (see templates/stripe/subscription.md).
   2. Address the warnings before going live.
   ```

3. **Never echo secret values** even when you read `.env`. Just report match / no-match against pattern.

## Anti-patterns

- Do NOT write files, run migrations, or modify settings during a `doctor` flow. Pure read.
- Do NOT recommend fixes that require live keys. First step is always: make the sandbox green.
- Do NOT skip categories. Even if early categories fail badly, run the full audit so the user gets a complete picture.
