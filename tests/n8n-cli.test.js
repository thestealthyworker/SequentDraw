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

// --- documentation export (.svg) ----------------------------------------

test('picks the SVG renderer from a .svg output extension', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli([FIXTURE, out], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    const svg = fs.readFileSync(out, 'utf8');
    assert.match(svg, /^<\?xml/);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /<!DOCTYPE html>/);
  });
});

test('--layers filters the SVG to the requested layers plus base', () => {
  withTempDir(dir => {
    const outAll = path.join(dir, 'all.svg');
    const outBase = path.join(dir, 'base.svg');
    const resultAll = runCli([FIXTURE, outAll, '--layers', 'business,edge,build'], dir);
    const resultBase = runCli([FIXTURE, outBase], dir);
    assert.strictEqual(resultAll.status, 0, resultAll.stderr);
    assert.strictEqual(resultBase.status, 0, resultBase.stderr);
    const svgAll = fs.readFileSync(outAll, 'utf8');
    const svgBase = fs.readFileSync(outBase, 'utf8');
    assert.ok(svgAll.length > svgBase.length, 'the all-layers export should carry more nodes than base alone');
  });
});

test('rejects an unknown layer name and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli([FIXTURE, out, '--layers', 'bogus'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown layer/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('rejects --layers with no value and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli([FIXTURE, out, '--layers'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('rejects --layers on an .html output and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli([FIXTURE, out, '--layers', 'business'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--layers is only valid with a \.svg/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('rejects an output extension that is neither .html nor .svg, and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.txt');
    const result = runCli([FIXTURE, out], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /must end in \.html or \.svg/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('rejects an unknown flag and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli([FIXTURE, out, '--bogus-flag'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
