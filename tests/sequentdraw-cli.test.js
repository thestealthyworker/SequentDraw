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
const { MAX_DOCUMENT_BYTES } = require('../src/cli/read-document');

// `input`, when given, is piped to the child's stdin; otherwise stdin is an
// empty pipe, so a "-" that is never fed still terminates instead of hanging.
function runCli(args, cwd, { input } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: cwd || ROOT, encoding: 'utf8', input });
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

// --evidence became OPTIONAL with the completeness engine
// (docs/design/business-map.md:14-16): a business map has no scan bundle, so
// "check map.json" runs structure plus completeness and nothing else.
test('check: without --evidence, a base-only map still passes with "ok"', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        title: 'compose-app map',
        nodes: [
          { id: 'web', label: 'Web', kind: 'service' },
          { id: 'api', label: 'Api', kind: 'service' },
        ],
        edges: [{ from: 'web', to: 'api', type: 'solid' }],
      })
    );
    const result = runCli(['check', mapPath]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'ok');
  });
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

// --- stdin: "-" as the input document ----------------------------------------
//
// Issue #31: a host may grant the CLI narrowly (`Bash(node:*)`, no Write
// tool), and then the only way to get map.json onto disk for check and
// render was a shell-string `node -e "fs.writeFileSync(...)"`. "-" reads
// the INPUT document from stdin instead. Output paths and --evidence stay
// real files, both sources share one size cap, and a malformed stdin
// fails with exactly the message a malformed file does.

const FIXTURE_TEXT = fs.readFileSync(FIXTURE, 'utf8');
const MALFORMED = '{"title": ';

test('validate -: reads the document from stdin and prints "ok"', () => {
  const result = runCli(['validate', '-'], undefined, { input: FIXTURE_TEXT });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'ok');
});

test('validate -: malformed stdin fails with the same message as a malformed file', () => {
  withTempDir(dir => {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, MALFORMED);
    const fromFile = runCli(['validate', bad]);
    const fromStdin = runCli(['validate', '-'], undefined, { input: MALFORMED });
    assert.strictEqual(fromFile.status, 1);
    assert.strictEqual(fromStdin.status, 1);
    assert.ok(fromStdin.stderr.trim().length > 0);
    assert.strictEqual(fromStdin.stderr, fromFile.stderr);
    assert.notStrictEqual(fromStdin.stdout.trim(), 'ok');
  });
});

test('validate -: an invalid document from stdin reports "path  message" lines, like a file would', () => {
  const input = JSON.stringify({ title: '', groups: [], nodes: [], edges: [] });
  const result = runCli(['validate', '-'], undefined, { input });
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.trim().length > 0);
  result.stderr
    .trim()
    .split('\n')
    .forEach(line => assert.match(line, /^\S*\s\s.+/));
});

test('validate -: stdin past the document cap fails loudly and exits 1', () => {
  const oversized = 'x'.repeat(MAX_DOCUMENT_BYTES + 1);
  const result = runCli(['validate', '-'], undefined, { input: oversized });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /stdin exceeds the \d+MB document limit/);
  assert.notStrictEqual(result.stdout.trim(), 'ok');
});

test('validate: a file past the document cap fails with the same limit message and is never parsed', () => {
  withTempDir(dir => {
    const big = path.join(dir, 'big.json');
    fs.writeFileSync(big, 'x'.repeat(MAX_DOCUMENT_BYTES + 1));
    const result = runCli(['validate', big]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /big\.json exceeds the \d+MB document limit/);
    assert.doesNotMatch(result.stderr, /JSON/);
  });
});

test('validate -: extra positional and unknown flag still print usage and exit 1', () => {
  const extra = runCli(['validate', '-', 'extra'], undefined, { input: FIXTURE_TEXT });
  assert.strictEqual(extra.status, 1);
  assert.match(extra.stderr, /Usage: sequentdraw validate/);
  const bogus = runCli(['validate', '-', '--bogus'], undefined, { input: FIXTURE_TEXT });
  assert.strictEqual(bogus.status, 1);
  assert.match(bogus.stderr, /Usage: sequentdraw validate/);
});

test('render - out.html --fragment: renders the fragment from stdin', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', '-', out, '--fragment'], undefined, { input: FIXTURE_TEXT });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*map\.html/);
    const html = fs.readFileSync(out, 'utf8');
    assert.ok(html.startsWith('<title>'));
    assert.doesNotMatch(html, /<html[\s>]/i);
  });
});

test('render - out.svg --layers a,b: renders the SVG from stdin', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.svg');
    const result = runCli(['render', '-', out, '--layers', 'business'], undefined, { input: FIXTURE_TEXT });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*map\.svg/);
    assert.match(fs.readFileSync(out, 'utf8'), /<svg[\s>]/);
  });
});

test('render: "-" as the OUTPUT path is rejected with usage and writes nothing', () => {
  withTempDir(dir => {
    const fromFile = runCli(['render', FIXTURE, '-'], dir);
    assert.strictEqual(fromFile.status, 1);
    assert.match(fromFile.stderr, /Usage: sequentdraw render/);
    assert.match(fromFile.stderr, /only valid as the input document/);
    const bothDashes = runCli(['render', '-', '-'], dir, { input: FIXTURE_TEXT });
    assert.strictEqual(bothDashes.status, 1);
    assert.match(bothDashes.stderr, /only valid as the input document/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('render -: malformed stdin fails with the malformed-file message and writes nothing', () => {
  withTempDir(dir => {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, MALFORMED);
    const out = path.join(dir, 'map.html');
    const fromFile = runCli(['render', bad, out]);
    const fromStdin = runCli(['render', '-', out], undefined, { input: MALFORMED });
    assert.strictEqual(fromFile.status, 1);
    assert.strictEqual(fromStdin.status, 1);
    assert.strictEqual(fromStdin.stderr, fromFile.stderr);
    assert.deepStrictEqual(fs.readdirSync(dir), ['bad.json']);
  });
});

test('render -: a usage error is reported even when a document is waiting on stdin, and writes nothing', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'map.html');
    const result = runCli(['render', '-', out, '--bogus'], undefined, { input: FIXTURE_TEXT });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw render/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('check - --evidence bundle.json: reads the map from stdin and prints "ok"', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const ids = evidenceIds(bundlePath);
    const map = JSON.stringify({
      title: 'compose-app map',
      nodes: [
        { id: 'web', label: 'Web', kind: 'service', source: 'scan', evidence: [ids.web] },
        { id: 'api', label: 'Api', kind: 'service', source: 'scan', evidence: [ids.api] },
      ],
      edges: [{ from: 'web', to: 'api', type: 'solid', source: 'scan', evidence: [ids.webDependsOnApi] }],
    });
    const result = runCli(['check', '-', '--evidence', bundlePath], undefined, { input: map });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'ok');
  });
});

test('check -: an evidence violation from a stdin map fails with its documented code', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const map = JSON.stringify({
      title: 'compose-app map',
      nodes: [{ id: 'web', label: 'Web', kind: 'service', source: 'scan', evidence: ['ev-does-not-exist'] }],
      edges: [],
    });
    const result = runCli(['check', '-', '--evidence', bundlePath], undefined, { input: map });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /which is not in the scan bundle/);
  });
});

test('check -: malformed stdin fails with the same message as a malformed file', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, MALFORMED);
    const fromFile = runCli(['check', bad, '--evidence', bundlePath]);
    const fromStdin = runCli(['check', '-', '--evidence', bundlePath], undefined, { input: MALFORMED });
    assert.strictEqual(fromFile.status, 1);
    assert.strictEqual(fromStdin.status, 1);
    assert.strictEqual(fromStdin.stderr, fromFile.stderr);
  });
});

test('check: "-" for --evidence is rejected with usage, in both flag spellings', () => {
  const spaced = runCli(['check', FIXTURE, '--evidence', '-'], undefined, { input: '{}' });
  assert.strictEqual(spaced.status, 1);
  assert.match(spaced.stderr, /Usage: sequentdraw check/);
  assert.match(spaced.stderr, /--evidence must be a real file/);
  const joined = runCli(['check', FIXTURE, '--evidence=-'], undefined, { input: '{}' });
  assert.strictEqual(joined.status, 1);
  assert.match(joined.stderr, /--evidence must be a real file/);
});

// --- check: completeness and --emit-open ----------------------------------
//
// The reference fixture carries a business layer, so the completeness rules
// run on it and find exactly the four gaps docs/design/business-map.md:218-222
// measures: refund_out (rule 1) and the three edge-layer dead ends (rule 6).

test('check: the reference fixture reports its four completeness gaps and exits 1', () => {
  const result = runCli(['check', FIXTURE]);
  assert.strictEqual(result.status, 1);
  const lines = result.stderr.trim().split('\n');
  assert.strictEqual(lines.length, 4, result.stderr);
  lines.forEach(line => assert.match(line, /^\S*\s\s.+/));
  assert.match(result.stderr, /Artifact "refund_out" has no outgoing edge/);
  ['req_action', 'partial', 'cancel'].forEach(id => {
    assert.match(result.stderr, new RegExp(`Node "${id}" is on the edge layer with no outgoing edge`));
  });
  assert.notStrictEqual(result.stdout.trim(), 'ok');
});

test('check --emit-open: writes a copy, exits 0, and the copy re-checks to "ok"', () => {
  withTempDir(dir => {
    const out = path.join(dir, 'gaps.json');
    const before = fs.readFileSync(FIXTURE, 'utf8');
    const result = runCli(['check', FIXTURE, '--emit-open', out]);
    // Exit 0 even though gaps were found: the flag's job was to emit, and
    // git-map's documented re-run-until-"ok" loop must stay coherent.
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*gaps\.json \(4 open nodes\)/);
    // The gap lines are still printed, in the same shape, so a skill can read
    // them off stderr in both modes.
    assert.strictEqual(result.stderr.trim().split('\n').length, 4);

    const copy = JSON.parse(fs.readFileSync(out, 'utf8'));
    const emitted = copy.nodes.filter(n => n.status === 'open');
    assert.strictEqual(emitted.length, 4);
    emitted.forEach(n => {
      assert.match(n.id, /^q_/);
      assert.ok(n.prompt.length > 0 && n.prompt.length < 500);
      assert.strictEqual('source' in n, false);
    });

    const recheck = runCli(['check', out]);
    assert.strictEqual(recheck.status, 0, recheck.stderr);
    assert.strictEqual(recheck.stdout.trim(), 'ok');

    // The input is never modified in place.
    assert.strictEqual(fs.readFileSync(FIXTURE, 'utf8'), before);
    assert.ok(fs.readFileSync(out, 'utf8').endsWith('\n'));
  });
});

test('check --emit-open: a map with no gaps still writes the copy and exits 0', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const out = path.join(dir, 'gaps.json');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        title: 'tiny business map',
        nodes: [
          { id: 'customer', label: 'Customer', kind: 'external', layers: ['business'] },
          { id: 'job', label: 'Do the job', kind: 'manual', layers: ['base', 'business'] },
          { id: 'invoice', label: 'Invoice', kind: 'artifact', layers: ['business'] },
          { id: 'late', label: 'Nobody pays', kind: 'logic', layers: ['edge'] },
          { id: 'owner', label: 'Office manager', kind: 'human', layers: ['edge', 'business'] },
        ],
        edges: [
          { from: 'customer', to: 'job', type: 'solid' },
          { from: 'job', to: 'invoice', type: 'solid' },
          { from: 'invoice', to: 'customer', type: 'solid' },
          { from: 'invoice', to: 'late', type: 'dashed', condition: 'unpaid' },
          { from: 'late', to: 'owner', type: 'solid' },
        ],
      })
    );
    const plain = runCli(['check', mapPath]);
    assert.strictEqual(plain.status, 0, plain.stderr);
    const result = runCli(['check', mapPath, '--emit-open', out]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*gaps\.json \(0 open nodes\)/);
    assert.ok(fs.existsSync(out));
  });
});

test('check --evidence --emit-open together: both run, and the copy is written', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const out = path.join(dir, 'gaps.json');
    const result = runCli(['check', FIXTURE, '--evidence', bundlePath, '--emit-open', out]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*gaps\.json \(4 open nodes\)/);
  });
});

test('check --emit-open: an evidence violation writes nothing and exits 1', () => {
  withTempDir(dir => {
    const bundlePath = scanComposeApp(dir);
    const mapPath = path.join(dir, 'map.json');
    const out = path.join(dir, 'gaps.json');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        title: 'compose-app map',
        nodes: [
          { id: 'web', label: 'Web', kind: 'service', source: 'scan', evidence: ['ev-does-not-exist'] },
          { id: 'person', label: 'Ops', kind: 'human', layers: ['business'] },
        ],
        edges: [{ from: 'person', to: 'web', type: 'solid' }],
      })
    );
    const result = runCli(['check', mapPath, '--evidence', bundlePath, '--emit-open', out]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /which is not in the scan bundle/);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

test('check --emit-open: a structurally invalid document writes nothing and exits 1', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const out = path.join(dir, 'gaps.json');
    fs.writeFileSync(mapPath, JSON.stringify({ title: '', nodes: [], edges: [] }));
    const result = runCli(['check', mapPath, '--emit-open', out]);
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.trim().length > 0);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

test('check --emit-open: a copy that would breach a cap writes nothing and exits 1', () => {
  withTempDir(dir => {
    // 100 nodes is the cap (src/n8n/validate.js:74); 99 valid nodes plus one
    // gap would be 100... so 100 nodes with two gaps cannot be emitted.
    const nodes = [{ id: 'ops', label: 'Ops', kind: 'human', layers: ['business'] }];
    for (let i = 0; i < 99; i++) {
      nodes.push({ id: `inv${i}`, label: `Invoice ${i}`, kind: 'artifact', layers: ['business'] });
    }
    const edges = nodes.slice(1).map(n => ({ from: 'ops', to: n.id, type: 'solid' }));
    const mapPath = path.join(dir, 'map.json');
    const out = path.join(dir, 'gaps.json');
    fs.writeFileSync(mapPath, JSON.stringify({ title: 'capped', nodes, edges }));
    const result = runCli(['check', mapPath, '--emit-open', out]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /nothing was written/);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

test('check --emit-open: "-" is rejected with usage, in both flag spellings', () => {
  const spaced = runCli(['check', FIXTURE, '--emit-open', '-']);
  assert.strictEqual(spaced.status, 1);
  assert.match(spaced.stderr, /Usage: sequentdraw check/);
  assert.match(spaced.stderr, /--emit-open must be a real file/);
  const joined = runCli(['check', FIXTURE, '--emit-open=-']);
  assert.strictEqual(joined.status, 1);
  assert.match(joined.stderr, /--emit-open must be a real file/);
});

test('check --emit-open: naming the input document is a usage error, and it is untouched', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const text = fs.readFileSync(FIXTURE, 'utf8');
    fs.writeFileSync(mapPath, text);
    const result = runCli(['check', mapPath, '--emit-open', path.join(dir, '.', 'map.json')]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /must not name the input document/);
    assert.strictEqual(fs.readFileSync(mapPath, 'utf8'), text);
  });
});

test('check --emit-open with a missing value prints usage and writes nothing', () => {
  withTempDir(dir => {
    const result = runCli(['check', FIXTURE, '--emit-open'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: sequentdraw check/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

// --- the skills' suggestion pipeline --------------------------------------
//
// business-map, eval-build and grill-build pass documents as
// `printf '%s' '<json>' | node <bin> check - --emit-open <folder>/x.json`,
// with every apostrophe in the JSON written as ', then check and render
// the written file. A quoted heredoc is not used: a narrow `Bash(node:*)`
// grant refuses a heredoc whose body is a JSON object. This runs that exact
// shell form, so a change to how stdin, --emit-open or rule 6a behave cannot
// silently break the documented pipeline.

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runPrintfPipe(doc, args, cwd) {
  const json = JSON.stringify(doc, null, 2).replace(/'/g, '\\u0027');
  const command = `printf '%s' '${json}' | ${shellQuote(process.execPath)} ${shellQuote(BIN)} ${args.map(shellQuote).join(' ')}`;
  return spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' });
}

const SUGGESTION_BASE = {
  title: "Owner's booking flow",
  nodes: [
    { id: 'customer', label: 'Customer', kind: 'external', layers: ['business'], source: 'user' },
    { id: 'schedule', label: 'Schedule cleaner', kind: 'manual', layers: ['base', 'business'], source: 'user' },
    { id: 'invoice', label: 'Invoice', kind: 'artifact', layers: ['business'], source: 'user' },
  ],
  edges: [
    { from: 'customer', to: 'schedule', type: 'solid', source: 'user' },
    { from: 'schedule', to: 'invoice', type: 'solid', source: 'user' },
    { from: 'invoice', to: 'customer', type: 'solid', source: 'user' },
  ],
};

test('skill pipeline: printf-piped emit into a new folder, suggestions, re-emit, render', () => {
  withTempDir(dir => {
    const gaps = runPrintfPipe(SUGGESTION_BASE, ['check', '-', '--emit-open', 'out/deep/gaps.json'], dir);
    assert.strictEqual(gaps.status, 0, gaps.stderr);
    assert.match(gaps.stdout, /^wrote out\/deep\/gaps\.json \(0 open nodes, 1 note\)$/m);
    assert.match(gaps.stderr, /unhappy-paths-missing|nothing goes wrong in it/);

    const emitted = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'deep', 'gaps.json'), 'utf8'));
    assert.strictEqual(emitted.title, "Owner's booking flow");

    const suggested = {
      ...emitted,
      nodes: [
        ...emitted.nodes,
        {
          id: 's_calendly',
          label: 'Calendly',
          kind: 'service',
          layers: ['base'],
          status: 'suggested',
          source: 'model',
          rationale: "You schedule the cleaner by hand; a booking link lets the customer pick the slot.",
          cites: ['schedule'],
          integration: 'calendly',
        },
      ],
      edges: [...emitted.edges, { from: 'schedule', to: 's_calendly', type: 'dashed', source: 'model' }],
    };
    const saved = runPrintfPipe(suggested, ['check', '-', '--emit-open', 'out/deep/suggested.json'], dir);
    assert.strictEqual(saved.status, 0, saved.stderr);
    // Re-emitting a copy that already carries rule 6a's note adds nothing.
    assert.match(saved.stdout, /^wrote out\/deep\/suggested\.json \(0 open nodes\)$/m);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'deep', 'suggested.json'), 'utf8'));
    assert.deepStrictEqual(written.notes.map(n => n.id), ['n_consider_unhappy_paths']);
    assert.strictEqual(written.nodes.find(n => n.id === 's_calendly').rationale, suggested.nodes[3].rationale);

    const render = runCli(['render', 'out/deep/suggested.json', 'out/site/map.html', '--fragment'], dir);
    assert.strictEqual(render.status, 0, render.stderr);
    assert.match(render.stdout, /^wrote out\/site\/map\.html \(\d+kb\)$/m);
  });
});

test('skill pipeline: a suggestion error is reported and nothing is written', () => {
  withTempDir(dir => {
    const bad = {
      ...SUGGESTION_BASE,
      nodes: [
        ...SUGGESTION_BASE.nodes,
        { id: 's_x', label: 'X', kind: 'service', layers: ['base'], status: 'suggested', source: 'model', rationale: 'r', cites: ['schedule'], integration: 'not-in-catalogue' },
      ],
      edges: [...SUGGESTION_BASE.edges, { from: 'schedule', to: 's_x', type: 'dashed' }],
    };
    const result = runPrintfPipe(bad, ['check', '-', '--emit-open', 'out/x.json'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /^\/nodes\/3\/integration {2}Node "s_x" integration "not-in-catalogue" is not in the SequentDraw catalogue\.$/m);
    assert.strictEqual(fs.existsSync(path.join(dir, 'out')), false);
  });
});

test('check --help documents --evidence as optional and --emit-open', () => {
  const result = runCli(['check', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /\[--evidence <bundle\.json>\] \[--emit-open <out\.json>\]/);
  assert.match(result.stdout, /Optional: without it the evidence cross-reference is/);
});

test('top-level usage documents "-" as the stdin input document', () => {
  const result = runCli(['--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /"-" as the input document reads it from stdin/);
});
