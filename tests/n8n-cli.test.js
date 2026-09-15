// CLI argument handling: flags and extra arguments must fail loudly instead of
// being mistaken for an output path (a stray `--layout` file was written this way).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src/n8n/cli.js');
const FIXTURE = path.join(ROOT, 'examples/medusa-return-flow.json');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-cli-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('renders the fixture into a directory that does not exist yet', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'nested', 'map.html');
    const result = runCli([FIXTURE, out], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!DOCTYPE html>'));
  });
});

test('rejects a flag in place of the output path and writes nothing', () => {
  withTempDir(dir => {
    const result = runCli([FIXTURE, '--layout'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('rejects extra arguments and writes nothing', () => {
  withTempDir(dir => {
    const result = runCli([FIXTURE, path.join(dir, 'map.html'), 'rows'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('reports a missing input file as a clear error', () => {
  withTempDir(dir => {
    const result = runCli([path.join(dir, 'missing.json'), path.join(dir, 'map.html')], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /missing\.json/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
