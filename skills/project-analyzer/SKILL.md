---
name: project-analyzer
description: Detects a project's technology stack, framework, deploy target, ORM, primary language, and active payment use cases by reading package.json/pyproject.toml/composer.json/Gemfile, schema files, route files, and deploy configs. Use this skill at the start of any PagoKit flow to ground recommendations in the real project context. Emits a structured detection result for payment-advisor and integration-specialist to consume.
when_to_use: |
  - Beginning of /pagokit:start, before asking the user any questions
  - When integration-specialist needs to know stack + ORM + deploy target before writing files
  - When /pagokit:doctor audits an existing integration
allowed-tools: Read, Glob, Grep, Bash(ls *), Bash(cat *)
---

# project-analyzer

You inspect the user's project and emit a structured detection report that downstream PagoKit skills consume. You do NOT recommend a payment method — that is payment-advisor's job. You also do NOT write any files.

## What you read (in order)

1. **Manifests** — first hit wins for stack detection:
   - `package.json` (Node.js / Bun ecosystem)
   - `pyproject.toml`, `requirements.txt`, `Pipfile` (Python)
   - `composer.json` (PHP)
   - `Gemfile` (Ruby)
   - `go.mod` (Go)
   - `*.csproj`, `*.fsproj` (.NET)
2. **Framework signal** — look at dependencies:
   - `next` → `nextjs-app-router` if `app/` directory exists, else `nextjs-pages-router`
   - `express` → `express`
   - `@nestjs/core` → `nestjs`
   - `fastapi` → `fastapi`
   - `django` → `django`
   - `flask` → `flask`
   - `laravel/framework` → `laravel`
   - Rails: presence of `Gemfile` + `config/application.rb`
   - Default to `unknown` if no clear signal.
3. **ORM** — look at deps + presence of schema files:
   - `@prisma/client` + `prisma/schema.prisma` → `prisma`
   - `drizzle-orm` + `drizzle.config.*` → `drizzle`
   - `sqlalchemy` + `alembic.ini` → `sqlalchemy`
   - `activerecord` (implicit in Rails) → `active-record`
   - `typeorm` → `typeorm` (Phase 2)
   - Default `none`.
4. **Deploy target** — look at config files (read existence, not contents):
   - `vercel.json` or `.vercel/` → `vercel`
   - `railway.toml`, `railway.json` → `railway`
   - `render.yaml` → `render`
   - `fly.toml` → `fly`
   - `Procfile` (and no other PaaS file) → `heroku`
   - `amplify.yml` → `aws-amplify`
   - `wrangler.toml`, `wrangler.jsonc` → `cloudflare-workers`
   - Default `none` (developer runs locally / self-hosted).
5. **Route files** — Glob for:
   - `app/**/route.{ts,js}` (Next.js App Router)
   - `pages/api/**/*.{ts,js}` (Next.js Pages Router)
   - `routes/*.{js,ts,php,rb}`
   - `urls.py`, `main.py`, `app.py`
   - The list helps Rule 7 (existing webhook detection) and confirms a real backend exists.
6. **DB schema** — Glob for:
   - `prisma/schema.prisma`
   - `drizzle/schema.{ts,js}` or `**/schema/*.ts`
   - `alembic/versions/*.py`
   - `db/schema.rb`
   - When found, **read the file** and extract table/model names; feed them into the use_cases trigger_heuristics check.
7. **README + CLAUDE.md** — read both to extract a one-sentence product description. Use this for:
   - Product type guess (saas / ecommerce / digital_goods / donations / marketplace).
   - Language fallback (if user's prompt language is ambiguous).

## Use case detection

Load `skills/payment-advisor/data/use_cases.json`. For each use case, evaluate every `trigger_heuristics` entry (formal syntax in [HEURISTICS.md](./HEURISTICS.md)). Compute a confidence score:

```
confidence = matches / total_heuristics
```

Mark a use case as **detected** if `confidence >= confidence_threshold`. Mark as **ambiguous** if `0 < confidence < threshold`. Mark as **not present** if `confidence == 0`.

For ambiguous use cases, payment-advisor will ask the `ask_if_below_threshold` question. For detected use cases, payment-advisor proceeds without asking.

## Language detection

The agent's output language is determined in this priority:

1. The language of the user's first prompt to `/pagokit:start` (Spanish / English / Portuguese / French / German).
2. If ambiguous, the language of the project's `README.md`.
3. Default: English.

Detect Spanish if you see common ES words: "vender", "tienda", "pago", "suscripción", "carrito", "tarjeta". Portuguese for BR: "venda", "pagamento", "assinatura", "cartão".

## Greenfield mode

If the project lacks both a route file AND a schema file AND the README is empty/missing, mark `greenfield: true`. payment-advisor will skip the "I detected X — correct?" confirmation and instead ask "What do you plan to sell?".

## Output format (structured)

Emit your detection report in this exact JSON-like shape (in a fenced ```json block in your reply), then continue in natural language:

```json
{
  "stack": "nextjs-app-router|nextjs-pages-router|express|nestjs|fastapi|django|flask|laravel|rails|go-gin|dotnet|hono|unknown",
  "framework_version": "string or null",
  "language": "es|en|pt|fr|de|other",
  "deploy_target": "vercel|railway|render|fly|heroku|aws-amplify|cloudflare-workers|none",
  "orm": "prisma|drizzle|sqlalchemy|active-record|typeorm|none",
  "package_manager": "npm|pnpm|yarn|bun|pip|poetry|composer|bundler|other",
  "route_files": ["app/api/checkout/route.ts", "..."],
  "schema_files": ["prisma/schema.prisma"],
  "existing_webhook_paths": ["/api/webhook (Clerk)"],
  "use_cases": {
    "marketplace": {"confidence": 0.0, "status": "not_present"},
    "mobile_digital_goods": {"confidence": 0.0, "status": "not_present"},
    "save_card_subscription": {"confidence": 0.5, "status": "ambiguous"},
    "creator_donations": {"confidence": 0.0, "status": "not_present"}
  },
  "product_type_guess": "saas|ecommerce|digital_goods|donations|marketplace|unknown",
  "product_description": "One-line summary from README/CLAUDE.md or null",
  "greenfield": false
}
```

Then immediately follow up in natural language (in the detected language) with a one-paragraph human summary that payment-advisor will use as the "I detected X — correct?" confirmation step.

## Anti-patterns

- Do **not** ask the user any questions in this skill — that is payment-advisor's role.
- Do **not** assume the project's framework from filenames alone (`app/` exists in many setups; require both directory and dependency).
- Do **not** read every file in the repo. Stop at manifests + schema + route files + README/CLAUDE.md. A full read costs tokens and rarely changes the detection.
- Do **not** invent a deploy target. If no config file matches, the answer is `none`.
- Do **not** classify the product type with confidence > 0.6 if the only signal is the README — ask payment-advisor to confirm.
