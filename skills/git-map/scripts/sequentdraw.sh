#!/usr/bin/env bash
# Calls the SequentDraw CLI. Prefers the bundled plugin binary
# ($CLAUDE_PLUGIN_ROOT/bin/sequentdraw, set by Claude Code for an installed
# plugin) and falls back to `npx sequentdraw` for hosts that do not set
# CLAUDE_PLUGIN_ROOT (Codex, other CLI-only agents, or a manually-copied
# skill). Never installs or executes anything beyond the sequentdraw
# package itself.
set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -x "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" ]; then
  exec "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" "$@"
fi

exec npx --yes sequentdraw "$@"
