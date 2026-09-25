// package.json's "files" whitelist controls what `npm publish` ships. Per
// CLAUDE.md, the published package must exclude .claude/, CLAUDE.md,
// tests/, evals/, scripts/ and examples/reference/, while still shipping
// bin/, src/, schema/, skills/, hooks/, .claude-plugin/, README.md, LICENSE
// and CREDITS.md. `npm pack --dry-run --json` reports exactly what would be
// published without touching the registry or writing a tarball, so this
// test runs it for real rather than re-implementing npm's own "files"
// resolution.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function packedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const [pkg] = JSON.parse(out);
  return pkg.files.map(f => f.path);
}

const EXCLUDED_PREFIXES = ['.claude/', 'tests/', 'evals/', 'scripts/', 'examples/reference/'];
const EXCLUDED_EXACT = ['CLAUDE.md'];

const REQUIRED_PREFIXES = ['bin/', 'src/', 'schema/', 'skills/', 'hooks/', '.claude-plugin/'];
const REQUIRED_EXACT = ['README.md', 'LICENSE', 'CREDITS.md'];

test('npm pack excludes internal tooling and dev-only directories', () => {
  const files = packedFiles();

  EXCLUDED_PREFIXES.forEach(prefix => {
    const offenders = files.filter(f => f === prefix.replace(/\/$/, '') || f.startsWith(prefix));
    assert.deepStrictEqual(offenders, [], `no packed file should start with "${prefix}"`);
  });

  EXCLUDED_EXACT.forEach(name => {
    assert.ok(!files.includes(name), `"${name}" must not be packed`);
  });
});

test('npm pack ships the plugin surface: bin, src, schema, skills, hooks, .claude-plugin, README, LICENSE, CREDITS', () => {
  const files = packedFiles();

  REQUIRED_PREFIXES.forEach(prefix => {
    const present = files.some(f => f.startsWith(prefix));
    assert.ok(present, `at least one packed file should start with "${prefix}"`);
  });

  REQUIRED_EXACT.forEach(name => {
    assert.ok(files.includes(name), `"${name}" should be packed`);
  });
});

test('npm pack does not include package.json itself twice or any stray dotfile config', () => {
  const files = packedFiles();
  // Sanity guard against a "files" glob accidentally slurping in local
  // config -- package.json is always included by npm regardless of
  // "files" and does not need a whitelist entry, but nothing else at the
  // repo root should sneak in.
  const rootLevelFiles = files.filter(f => !f.includes('/'));
  const allowedRootFiles = new Set(['package.json', 'README.md', 'LICENSE', 'CREDITS.md']);
  rootLevelFiles.forEach(f => {
    assert.ok(allowedRootFiles.has(f), `unexpected root-level packed file: "${f}"`);
  });
});
