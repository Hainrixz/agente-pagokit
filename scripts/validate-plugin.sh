#!/usr/bin/env bash
# PagoKit — validate-plugin.sh
#
# Orchestrator: installs dev deps if needed, runs data validation,
# and invokes `claude plugin validate` if Claude Code CLI is available.

set -e

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "==> Installing dev dependencies (ajv, ajv-formats)..."
  npm install --no-audit --no-fund --silent
fi

echo ""
echo "==> Validating data files against JSON Schemas..."
node scripts/validate-data.js

echo ""
if command -v claude >/dev/null 2>&1; then
  echo "==> Running 'claude plugin validate'..."
  claude plugin validate . || echo "[WARN] 'claude plugin validate' reported issues (see above)."
else
  echo "[SKIP] claude CLI not found; skipping 'claude plugin validate'."
fi

echo ""
echo "==> Done."
