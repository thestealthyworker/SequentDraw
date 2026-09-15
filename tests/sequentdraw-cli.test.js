// The `bin/sequentdraw` CLI dispatcher: render/validate/scan/check
// subcommands, strict argument handling (unknown flags and extra
// positionals print usage and exit 1, nothing is written on error), and
// --help for each subcommand. Mirrors the contract tests/n8n-cli.test.js
// already pins for the legacy `node src/n8n/cli.js` entry, which this file
// does not touch.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');
const FIXTURE = path.join(ROOT, 'examples', 'medusa-return-flow.json');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: cwd || ROOT, encoding: 'utf8' });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-bin-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- top level ------------------------------------------------------------

test('no command prints usage to stderr and exits 1', () => {
  const result = runCli([]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Usage: sequentdraw <command>/);
});

test('--help prints usage to stdout and exits 0', () => {
  const result = runCli(['--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Usage: sequentdraw <command>/);
});

test('an unknown command prints usage and exits 1', () => {
  const result = runCli(['bogus']);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Unknown command "bogus"/);
  assert.match(result.stderr, /Usage: sequentdraw <command>/);
});

// --- render ----------------------------------------------------------------

test('render: writes an HTML file from the fixture', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', FIXTURE, out]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!DOCTYPE html>'));
  });
});

test('render --fragment: writes a fragment with no <html>/<head>/<body>', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', FIXTURE, out, '--fragment']);
    assert.strictEqual(result.status, 0, result.stderr);
    const html = fs.readFileSync(out, 'utf8');
    assert.ok(html.startsWith('<title>'));
    assert.doesNotMatch(html, /<html[\s>]/i);
    assert.doesNotMatch(html, /<body[\s>]/i);
  });
});

test('render --fragment on a .svg output is rejected and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli(['render', FIXTURE, out, '--fragment']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--fragment is only valid with an \.html/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('render --layers on an .html output is still rejected (unchanged rule) and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', FIXTURE, out, '--layers', 'business']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--layers is only valid with a \.svg/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('render: unknown flag prints usage and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', FIXTURE, out, '--bogus']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw render/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('render: extra positional prints usage and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', FIXTURE, out, 'extra']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw render/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('render --help exits 0 and prints usage without writing anything', () => {
  withTempDir(dir => {
    const result = runCli(['render', '--help'], dir);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: sequentdraw render/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

// --- validate ----------------------------------------------------------------

test('validate: prints "ok" and exits 0 for a valid document', () => {
  const result = runCli(['validate', FIXTURE]);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'ok');
});

test('validate: prints one "path  message" line per error and exits 1', () => {
  withTempDir(dir => {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ title: '', groups: [], nodes: [], edges: [] }));
    const result = runCli(['validate', bad]);
    assert.strictEqual(result.status, 1);
    assert.notStrictEqual(result.stdout.trim(), 'ok');
    assert.ok(result.stderr.trim().length > 0);
    result.stderr
      .trim()
      .split('\n')
      .forEach(line => assert.match(line, /^\S*\s\s.+/));
  });
});

test('validate: missing input file is a clear error and exits 1', () => {
  withTempDir(dir => {
    const result = runCli(['validate', path.join(dir, 'missing.json')]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /missing\.json/);
  });
});

test('validate: extra positional prints usage and exits 1', () => {
  const result = runCli(['validate', FIXTURE, 'extra']);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Usage: sequentdraw validate/);
});

test('validate --help exits 0 and prints usage', () => {
  const result = runCli(['validate', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Usage: sequentdraw validate/);
});

// --- scan / check (placeholders until the scanner merges) -----------------

test('scan: exits 2 and reports unavailability', () => {
  const result = runCli(['scan', '.']);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /available once the scanner is merged/);
});

test('scan --help exits 0 and prints usage', () => {
  const result = runCli(['scan', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Usage: sequentdraw scan/);
});

test('check: exits 2 and reports unavailability', () => {
  const result = runCli(['check', '--evidence', 'bundle.json']);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /available once the scanner is merged/);
});

test('check --help exits 0 and prints usage', () => {
  const result = runCli(['check', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Usage: sequentdraw check/);
});
