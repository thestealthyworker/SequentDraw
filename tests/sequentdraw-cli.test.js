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

// --- scan --------------------------------------------------------------
//
// Against the committed fixture repos under tests/fixtures/repos/ -- no
// network. compose-app's evidence ids are deterministic (evidence.js
// sorts before assigning "ev1", "ev2", ...), so the fixture map JSON
// files below can hardcode which ids exist without re-deriving them per
// test run.

const COMPOSE_APP = path.join(ROOT, 'tests', 'fixtures', 'repos', 'compose-app');

test('scan: writes a bundle for the compose-app fixture repo', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'bundle.json');
    const result = runCli(['scan', COMPOSE_APP, '--out', out]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*bundle\.json/);
    const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(bundle.repo.name, 'compose-app');
    assert.ok(bundle.evidence.some(e => e.kind === 'compose-service' && e.value === 'web'));
    assert.ok(bundle.evidence.some(e => e.kind === 'depends-on' && e.from === 'web' && e.to === 'api'));
  });
});

test('scan: an invalid GitHub host is rejected, prints one clear line, and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'bundle.json');
    const result = runCli(['scan', 'https://notgithub.example/owner/repo', '--out', out]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /git-map:.*github/i);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('scan: an invalid ref is rejected, prints one clear line, and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'bundle.json');
    const result = runCli(['scan', 'https://github.com/octocat/Hello-World/tree/--upload-pack=x', '--out', out]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /git-map:/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('scan: a scan-timeout is reported as one clear line and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'bundle.json');
    const result = runCli(['scan', COMPOSE_APP, '--out', out, '--timeout', '1']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /git-map: scan exceeded 1ms and was terminated\./);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('scan: missing --out prints usage and writes nothing', () => {
  withTempDir(dir => {
    const result = runCli(['scan', COMPOSE_APP], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw scan/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('scan: unknown flag prints usage and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'bundle.json');
    const result = runCli(['scan', COMPOSE_APP, '--out', out, '--bogus']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw scan/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('scan --help exits 0, prints usage, and writes nothing', () => {
  withTempDir(dir => {
    const result = runCli(['scan', '--help'], dir);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: sequentdraw scan/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

// --- check ---------------------------------------------------------------

function scanComposeApp(dir) {
  const bundlePath = path.join(dir, 'bundle.json');
  const scanResult = runCli(['scan', COMPOSE_APP, '--out', bundlePath]);
  assert.strictEqual(scanResult.status, 0, scanResult.stderr);
  return bundlePath;
}

// Evidence ids are positional, so they shift whenever the scanner learns
// to report something new. These tests are about the check contract, not
// about which id a fact happens to land on, so they look the ids up.
function evidenceIds(bundlePath) {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const find = predicate => {
    const entry = bundle.evidence.find(predicate);
    assert.ok(entry, 'expected fixture evidence is missing from the bundle');
    return entry.id;
  };
  return {
    web: find(e => e.kind === 'compose-service' && e.value === 'web'),
    api: find(e => e.kind === 'compose-service' && e.value === 'api'),
    webDependsOnApi: find(e => e.kind === 'depends-on' && e.from === 'web' && e.to === 'api'),
  };
}

test('check: a document citing real evidence ids passes with "ok"', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const ids = evidenceIds(bundlePath);
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        title: 'compose-app map',
        nodes: [
          { id: 'web', label: 'Web', kind: 'service', source: 'scan', evidence: [ids.web] },
          { id: 'api', label: 'Api', kind: 'service', source: 'scan', evidence: [ids.api] },
        ],
        edges: [{ from: 'web', to: 'api', type: 'solid', source: 'scan', evidence: [ids.webDependsOnApi] }],
      })
    );
    const result = runCli(['check', mapPath, '--evidence', bundlePath]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'ok');
  });
});

test('check: an unknown evidence id and a missing citation each fail with their documented code', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const ids = evidenceIds(bundlePath);
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        title: 'compose-app map',
        nodes: [
          { id: 'web', label: 'Web', kind: 'service', source: 'scan', evidence: ['ev-does-not-exist'] },
          { id: 'api', label: 'Api', kind: 'service', source: 'scan' },
        ],
        edges: [{ from: 'web', to: 'api', type: 'solid', source: 'scan', evidence: [ids.webDependsOnApi] }],
      })
    );
    const result = runCli(['check', mapPath, '--evidence', bundlePath]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /which is not in the scan bundle/); // unknown-evidence
    assert.match(result.stderr, /must cite at least one evidence id/); // evidence-required
  });
});

test('check: a structurally invalid document reports validateDoc errors and exits 1', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(mapPath, JSON.stringify({ title: '', nodes: [], edges: [] }));
    const result = runCli(['check', mapPath, '--evidence', bundlePath]);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.trim().length > 0);
  });
});

test('check: missing --evidence prints usage and exits 1', () => {
  const result = runCli(['check', FIXTURE]);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Usage: sequentdraw check/);
});

test('check: unknown flag prints usage and exits 1', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const result = runCli(['check', FIXTURE, '--evidence', bundlePath, '--bogus']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw check/);
  });
});

test('check --help exits 0 and prints usage', () => {
  const result = runCli(['check', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Usage: sequentdraw check/);
});
