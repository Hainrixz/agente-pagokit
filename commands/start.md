---
description: Analyze the current project and generate a production-ready payment integration (frontend + backend + webhook + DB + portal + refund).
argument-hint: (no arguments)
---

You are entering the PagoKit `start` flow.

Welcome the user briefly in their language (Spanish or English depending on the rest of their conversation):

> 🛒 **PagoKit** — voy a analizar tu proyecto y recomendarte el mejor método de pago. Después puedes correr `/pagokit:doctor` para auditar la integración o `/pagokit:test` para probar el webhook localmente.

(English equivalent if their messages are in English.)

Then proceed without further preamble:

1. **Invoke the `project-analyzer` skill** to detect stack, framework, deploy target, ORM, language, and use cases. Emit its structured JSON detection report in your reply (so the user sees what you saw), followed by the natural-language confirmation question.

2. **Wait for the user to confirm or correct** the detection (one round only — accept whatever they say and move on).

3. **Invoke the `payment-advisor` skill** to:
   - Ask the 3 core questions (country + buyers, billing mode, local methods).
   - Ask up to 2 conditional questions only if necessary.
   - Apply hard filters + score ranking.
   - Fall back to `regions[country].fallback_cross_border_mor` if no provider survives.
   - Present **top 1 recommendation** with fee calculated in real money for a typical transaction in the user's product type.
   - Cite `last_verified_at` as a disclaimer.

4. **Wait for the user's selection** — "sí / listo" to proceed, "muéstrame alternativas" for the next 1–2 options, or "pregunta" to dig in.

5. **Delegate to the `integration-specialist` subagent** once the user confirms. Pass the structured spec block (provider, stack, deploy_target, orm, billing_mode, frontend_style, required_methods, language, use_cases_detected, example_transaction_amount, example_currency).

6. **Relay the subagent's final report** to the user, plus a one-line legal-obligations footer based on detected region (GDPR / LGPD / LFPDPPP / CCPA / invoicing). Cite SECURITY_RULES Rule 11.

7. **Suggest next steps**:
   - "Ejecuta `/pagokit:test` para validar el webhook localmente con un evento firmado."
   - "Lee `PAGOKIT_INTEGRATION.md` para ver lo generado."
   - "Antes de pasar a producción, revisa `PAGOKIT_PRODUCTION_CHECKLIST.md`."

## Greenfield mode

If `project-analyzer` reports `greenfield: true`, skip step 2 (no detection to confirm) and add a question in step 3: "¿Qué planeas vender?". Then proceed.

## Anti-patterns

- Do NOT ask the user any question before `project-analyzer` runs.
- Do NOT skip the confirmation step (step 2) — users distrust silent inference.
- Do NOT show numeric scores. payment-advisor's output uses prose, not a leaderboard.
- Do NOT write any files in this command directly. integration-specialist subagent does all the writes.
- Do NOT use slash command `/pagokit:start` recursively — only one start flow per turn.
