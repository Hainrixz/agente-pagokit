#!/usr/bin/env bash
# PagoKit — dev-link.sh
#
# Helper for plugin authors: launch Claude Code in a target project directory
# with this plugin loaded locally (no need to install from GitHub).
#
# Usage:
#   ./scripts/dev-link.sh /path/to/test-project
#   ./scripts/dev-link.sh                          # uses current directory

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-$PWD}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

if [ "$TARGET_DIR" = "$PLUGIN_DIR" ]; then
  echo "WARNING: target is the plugin directory itself; you usually want to run this" >&2
  echo "in a separate test project so the plugin's own files don't appear as user code." >&2
fi

echo "==> Plugin source: $PLUGIN_DIR"
echo "==> Test project:  $TARGET_DIR"
echo ""

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: 'claude' CLI not found in PATH. Install Claude Code first:" >&2
  echo "  https://claude.ai/code" >&2
  exit 1
fi

cd "$TARGET_DIR"
exec claude --plugin-dir "$PLUGIN_DIR" "$@"
