# Railway — Deploy Target

Patterns for projects deployed to Railway. Required when `project-analyzer` detects `railway.toml` or `railway.json`.

## Environment variables

Railway uses per-service variables. Set via CLI:

```bash
# Set a test key for the dev/staging service
railway variables set STRIPE_SECRET_KEY=sk_test_... --service backend

# Or for production
railway variables set STRIPE_SECRET_KEY=sk_live_... --service backend
```

Or via the dashboard: Project → Service → Variables tab → "New Variable".

Repeat for every required env var per provider (same list as Vercel).

## Pull env vars to local

```bash
railway link  # if not already linked
railway run env > .env.local  # writes the linked service's env to local file
```

⚠️ Vet this carefully — `railway run env` dumps everything including service-internal vars. Strip what you don't need before committing... wait, don't commit at all. Just use it locally. Rule 2 (.env is gitignored) is non-negotiable.

## Service routing

Railway services typically expose a single public URL per service. The production webhook URL becomes:

```
https://<service>.up.railway.app/api/webhook/<provider>
```

Or a custom domain if configured.

Configure the URL in the provider's dashboard like with Vercel.

## Health checks and Procfile

Railway respects `Procfile`:

```
web: node dist/server.js
```

Or `railway.toml`:

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
restartPolicyType = "on_failure"
```

PagoKit's webhook routes don't need any special Railway config beyond the standard service setup — they're plain HTTP POST endpoints.

## Postgres on Railway

If the user provisioned a Railway Postgres add-on, the connection string is auto-injected as `DATABASE_URL`. Prisma / Drizzle / SQLAlchemy use it directly.

For Prisma:

```bash
railway run npx prisma migrate deploy
```

This runs the migration against Railway's Postgres without exposing the connection string locally.

## Cron jobs

Railway supports cron-style services. To run the idempotency cleanup daily, create a separate cron service in the same project pointing to a script:

```bash
# In a new service of type "Cron":
npx tsx scripts/pagokit-cleanup.ts
```

Schedule: `0 3 * * *` (daily at 03:00 UTC).

## Anti-patterns

- ❌ Mixing test and live keys across environments without explicit naming. Use Railway's environment feature (Production, Staging) to keep them apart.
- ❌ Skipping `healthcheckPath` → Railway may mark the service unhealthy and route traffic away during deploys.
- ❌ Hardcoding the Railway URL in env vars → use `${{RAILWAY_PUBLIC_DOMAIN}}` reference variables instead.
- ❌ Running `railway run env` and pasting into Slack/chat — secret leak risk.
