// The MCP server configuration a host needs to reach SequentDraw --
// the same two shapes docs/design/skills-and-plugin.md, "The MCP server",
// documents for a host other than Claude Code (which gets the server
// bundled through the plugin manifest instead). This is their one source
// in code, so `skills install`'s post-install printout can never drift
// from what that doc shows.

function jsonSnippet(binPath) {
  return JSON.stringify(
    {
      mcpServers: {
        sequentdraw: {
          command: 'node',
          args: [binPath, 'mcp'],
        },
      },
    },
    null,
    2,
  );
}

function tomlSnippet(binPath) {
  return `[mcp_servers.sequentdraw]\ncommand = "node"\nargs = ["${binPath}", "mcp"]`;
}

// Codex reaches the server through its own config.toml; every other
// MCP-speaking host this command installs for (Cursor, Copilot) uses the
// generic JSON "mcpServers" shape.
function mcpSnippetFor(agent, binPath) {
  return agent === 'codex' ? tomlSnippet(binPath) : jsonSnippet(binPath);
}

module.exports = { jsonSnippet, tomlSnippet, mcpSnippetFor };
