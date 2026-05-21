# project-analyzer — Trigger Heuristics Syntax

The `trigger_heuristics` field in `skills/payment-advisor/data/use_cases.json` is a list of formal strings that **project-analyzer is the sole consumer of**. Each string has the form:

```
<prefix>:<value>
```

Where `<prefix>` is one of the 8 keywords below.

## Prefixes

### `table:<table_name>`

Matches when the project's DB schema contains a table whose name equals `<table_name>` (case-insensitive, both singular and plural forms accepted).

Sources scanned:
- `prisma/schema.prisma` → `model <Name>` blocks (Prisma maps model name to table name by default; respect `@@map` directive if present).
- `drizzle/**/schema.{ts,js}` → `pgTable("name", …)` / `mysqlTable("name", …)` calls.
- `alembic/versions/*.py` → `op.create_table("name", …)` calls (cumulative across migrations).
- `db/schema.rb` → `create_table "name"` calls.

**Example:** `table:vendors` matches a Prisma `model Vendor` (default mapping `vendors`) or `model Vendor @@map("vendors")`.

### `model:<ModelName>`

Matches when an ORM model class with the exact name `<ModelName>` exists (case-sensitive).

Sources scanned: same as `table:` but matches the model identifier instead of the table identifier.

**Example:** `model:Seller` matches `model Seller` (Prisma), `class Seller(Base)` (SQLAlchemy), `class Seller < ApplicationRecord` (Active Record).

### `route:<pattern>`

Matches when the project registers an HTTP route whose path matches `<pattern>`. The pattern supports `*` as a single-segment wildcard and `**` for multi-segment.

Sources scanned:
- Next.js App Router: presence of a `route.{ts,js}` file at `app/<pattern>/route.{ts,js}`.
- Next.js Pages Router: presence of `pages/api/<pattern>.{ts,js}`.
- Express: `app.get/post/put/delete(<path>, …)` or `router.<verb>(<path>, …)` calls.
- FastAPI: `@app.<verb>("<path>")` or `@router.<verb>("<path>")` decorators.
- Django: `path("<path>", …)` or `re_path("<path>", …)` in `urls.py`.
- Laravel: `Route::<verb>('<path>', …)` in `routes/*.php`.
- Rails: `<verb> '<path>'` in `config/routes.rb`.

**Example:** `route:/seller/*` matches `app/seller/[id]/route.ts` (Next.js App Router) and `Route::get('/seller/{id}', …)` (Laravel).

### `package:<package_name>`

Matches when the project depends on `<package_name>` (any version) in its package manifest.

Sources scanned:
- `package.json` → `dependencies` + `devDependencies` keys.
- `pyproject.toml` → `[project.dependencies]` or Poetry's `[tool.poetry.dependencies]`.
- `requirements.txt` → top-level package name (before `==`, `>=`, etc.).
- `composer.json` → `require` + `require-dev` keys.
- `Gemfile` → `gem '<name>', …` lines.
- `go.mod` → `require <module>` lines.

**Example:** `package:react-native` matches React Native projects.

### `config:<filename>`

Matches when a top-level configuration file named exactly `<filename>` exists at the project root.

**Example:** `config:flutter.yaml` matches a Flutter project root.

### `file:<filename>`

Matches when a file with the exact basename `<filename>` exists ANYWHERE in the project (recursive glob, excluding `node_modules`, `.git`, `dist`, `build`, `__pycache__`).

**Example:** `file:Info.plist` matches an iOS Xcode project.

### `env:<VAR_NAME>`

Matches when the project's `.env.example`, `.env.sample`, or `.env.template` declares `<VAR_NAME>`.

**Example:** `env:STRIPE_CONNECT_CLIENT_ID` matches projects already using Stripe Connect.

### `dependency:<package_name>`

Synonym for `package:<package_name>` — included for readability when the use case clearly refers to a runtime dependency rather than a peer dep. Treated identically.

## Confidence score

For a use case with N heuristics:

```
confidence = matched_heuristics / N
```

Then compared against `confidence_threshold`:

- `confidence >= threshold` → status `"detected"`. payment-advisor does NOT ask the user.
- `0 < confidence < threshold` → status `"ambiguous"`. payment-advisor asks `ask_if_below_threshold`.
- `confidence == 0` → status `"not_present"`. payment-advisor ignores this use case.

## Examples worked out

For `use_cases.marketplace` with 9 heuristics:

```
trigger_heuristics: [
  "table:vendors", "table:sellers", "table:merchants",
  "model:Vendor", "model:Seller", "model:Merchant",
  "route:/seller/*", "route:/vendors/*",
  "package:@stripe/connect"
]
confidence_threshold: 0.7
```

A project with `model Vendor` in Prisma schema and `app/vendors/[id]/page.tsx` page (but no `route:/vendors/*` and no `@stripe/connect` package) would match `model:Vendor` only → confidence 1/9 ≈ 0.11 → ambiguous → payment-advisor asks the user.

A project with `model:Vendor`, `table:vendors`, `route:/seller/*`, and `package:@stripe/connect` → confidence 4/9 ≈ 0.44 → still below 0.7 → still ambiguous, but with enough signal that payment-advisor should phrase the question in a "confirming what I'm seeing" tone rather than from scratch.

## Adding new prefixes

If Phase 2/3 introduces a new heuristic type (e.g., `git-history:<pattern>` for "this project recently committed a Stripe file"), add it here first, then update project-analyzer's parser, then add the JSON Schema `pattern` in `schemas/use_cases.schema.json` to allow it. Never use undocumented prefixes in `use_cases.json`.
