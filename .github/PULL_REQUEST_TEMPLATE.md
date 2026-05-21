<!-- Thanks for the PR! -->

## What does this change?

<!-- One sentence. Use Conventional Commits style: feat:, fix:, docs:, chore:, art: -->

## Why?

<!-- The user pain or motivation. Link the related issue if applicable: Fixes #NN -->

## Type of change

- [ ] New payment provider (4 files added: providers.json entry, regions update, template dir, signatures.md entry)
- [ ] New stack adapter (`_stack-adapters/<stack>.md`)
- [ ] New / modified validator (with new fixtures in `__tests__/`)
- [ ] Bug fix
- [ ] Documentation
- [ ] Refactor / chore

## Checklist

- [ ] `npm run validate:data` passes
- [ ] `npm run test:validators` passes
- [ ] If I added a provider: `last_verified_at` is today's date and fees match the provider's current docs.
- [ ] If I changed a validator: existing fixtures still pass + I added new fixtures covering the change.
- [ ] No real-looking `sk_live_…` / `prv_prod_…` / `APP_USR-…` / `lmnsq_live_…` keys committed (used `*NOTAREALKEYJUSTAFIXTURE*` pattern in fixtures).
- [ ] I read [`CONTRIBUTING.md`](../blob/main/CONTRIBUTING.md) for the relevant section.
