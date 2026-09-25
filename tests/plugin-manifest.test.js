// .claude-plugin/plugin.json and marketplace.json: structural checks that
// complement `claude plugin validate . --strict` (which this repo's CI runs
// separately, docs/design/skills-and-plugin.md's "CI" table) -- in
// particular that plugin.json's version is kept in sync with package.json's,
// since nothing else enforces that automatically.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

test('plugin.json version matches package.json version', () => {
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.strictEqual(plugin.version, pkg.version);
});

test('plugin.json has the required identity fields', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.strictEqual(plugin.name, 'sequentdraw');
  assert.strictEqual(plugin.license, 'MIT');
  assert.ok(plugin.description && plugin.description.length > 0);
  assert.ok(plugin.homepage);
  assert.ok(plugin.repository);
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.length > 0);
});

test('marketplace.json lists this repo as its own marketplace with one plugin sourced from "./"', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.strictEqual(marketplace.name, 'sequentdraw');
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1);
  assert.strictEqual(marketplace.plugins[0].name, 'sequentdraw');
  assert.strictEqual(marketplace.plugins[0].source, './');
});

test('package.json exposes the sequentdraw CLI as its bin entry', () => {
  const pkg = readJson('package.json');
  assert.strictEqual(pkg.bin.sequentdraw, 'bin/sequentdraw');
});

// The MCP server is bundled through plugin.json's own "mcpServers" field, not
// a root-level .mcp.json: this repository is itself a project contributors
// open in Claude Code, and a root .mcp.json is loaded there too, as a
// project-scoped server, where ${CLAUDE_PLUGIN_ROOT} does not expand.
test('plugin.json bundles the MCP server inline, and no root .mcp.json shadows it', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.deepStrictEqual(plugin.mcpServers, {
    sequentdraw: {
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw', 'mcp'],
    },
  });
  assert.strictEqual(fs.existsSync(path.join(ROOT, '.mcp.json')), false);
});
