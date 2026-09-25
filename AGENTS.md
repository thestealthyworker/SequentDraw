# SequentDraw — agent notes

Generates architecture and business-process maps as self-contained interactive HTML
from a semantic JSON document. See [`README.md`](README.md) for what the tool is and
how to run it.

## Reaching SequentDraw

- **Skills** (`skills/<name>/SKILL.md`) are the primary interface in Claude Code and
  any host that reads the Agent Skills spec. Claude Code gets them from the plugin
  install; Codex, Copilot and Cursor get them from `sequentdraw skills install`
  (`docs/design/skills-and-plugin.md`, "Packaging").
- **An MCP server** (`sequentdraw mcp`, stdio, JSON-RPC 2.0) is for hosts that reach
  SequentDraw through MCP instead of a shell command: Cursor, Gemini CLI, Copilot, and
  Codex through its own `config.toml`. Claude Code gets the same server bundled
  through `.claude-plugin/plugin.json`'s own inline `mcpServers` field, not a
  repo-root `.mcp.json`.
- **The CLI** (`sequentdraw <command> ...`, or `node bin/sequentdraw <command> ...` in
  this repo) is always available and is what both of the above call underneath.

## The MCP tools give the same results as the CLI

Each MCP tool — `sequentdraw_render`, `sequentdraw_validate`, `sequentdraw_scan`,
`sequentdraw_check`, `sequentdraw_catalogue`, `sequentdraw_licences` — is a thin
adapter over the exact same command the CLI dispatches to (`src/mcp/tools.js` calls
`COMMANDS[name].run` from `src/cli/index.js`, the same function `bin/sequentdraw`
calls). There is no second implementation and no separate validation path, so an MCP
call and the equivalent CLI invocation always agree: the same output for the same
input, and the same refusal for the same bad input — an unverified repository link
that `sequentdraw check --repos` refuses is refused exactly the same way whether the
caller used the CLI or the MCP tool. A command that fails (an invalid document, an
unverified link) comes back from the MCP server as a tool result with `isError: true`,
not as a JSON-RPC error — JSON-RPC errors are reserved for protocol problems (an
unknown tool, an argument that fails its schema, a malformed request).

Full tool list, argument shapes and host configuration snippets:
[`docs/design/skills-and-plugin.md`](docs/design/skills-and-plugin.md), "The MCP
server".

## Ground rules

- The engine (`src/`) is the source of truth. Validate, check for gaps, and render
  through it rather than reasoning about layout or schema in prose.
- A tool suggestion enters a map as `suggested`, never as `confirmed`; the user
  accepts it.
- Read [`docs/SPEC.md`](docs/SPEC.md) for the document schema before writing one by
  hand.
