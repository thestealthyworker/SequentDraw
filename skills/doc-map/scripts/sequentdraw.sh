#!/usr/bin/env bash
# Calls the SequentDraw CLI. Prefers the bundled plugin binary, invoked
# explicitly through `node` (node "$CLAUDE_PLUGIN_ROOT/bin/sequentdraw" ...)
# rather than executed directly -- this is also what a Bash allow-tools
# grant narrowed to "Bash(node:*)" (as used in this plugin's own CI skill
# evals) matches, and it needs neither the file's executable bit nor a
# working shebang line, so it is more portable too. Falls back to
# `npx sequentdraw` for hosts that do not set CLAUDE_PLUGIN_ROOT (Codex,
# other CLI-only agents, or a manually-copied skill). Never installs or
# executes anything beyond the sequentdraw package itself.
set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" ]; then
  exec node "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" "$@"
fi

exec npx --yes sequentdraw "$@"
