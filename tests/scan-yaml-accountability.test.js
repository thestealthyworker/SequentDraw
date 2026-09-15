// Fix round 3: "a scan is never silently partial" for YAML content
// specifically. The root cause this round found: SafeProvider.open()'s
// generic hasOverlongLine() "looks minified" heuristic used to run
// UNCONDITIONALLY, before the YAML-specific checks -- so a single-line
// flow mapping with thousands of entries (a normal, if unusual, YAML
// construct, not evidence of minification) silently dropped the WHOLE
// file, including a legitimate `services:` block after it, with zero
// finding. Every test here goes through scanRepo() (the real
// worker_threads path, not scanPath()/inProcess), per the fix
// requirement, since that is the path an actual caller uses.
//
// Which *.yml/*.yaml files are "targeted" (a custom parser looks at
// their content for evidence), per src/scan/scan.js:
//   - docker-compose*.yml (COMPOSE_FILE_RE)
//   - .github/workflows/*.yml (WORKFLOW_FILE_RE)
// Any other *.yml/*.yaml file is still classified/parsed by
// SafeProvider (so a hostile one still cannot hang or leak), but no
// custom parser extracts evidence from it, and stack-analyser's own
// rules may or may not have an opinion on it -- a plain, unrelated
// config.yml with no compose/workflow shape is expected to produce
// neither evidence nor a finding, documented below rather than treated
// as a silent-drop bug.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanRepo } = require('../src/scan/index');

// Worker startup (spawning the thread, loading @specfy/stack-analyser)
// adds real overhead on top of whatever the content itself costs, and
// this machine has been measured 4-8x slower than isolation under
// `npm test`'s full concurrent load. The property under test in every
// case below is "does not silently drop content or take anywhere near
// as long as the original, effectively-unbounded bug", not a tight
// latency number.
const SCAN_TIMEOUT_MS = 30000;

function withTempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-yaml-accountability-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function floodCompose(keys) {
  const entries = Array.from({ length: keys }, (_, i) => `k${i}: 1`).join(', ');
  return `x-flood: {${entries}}\nservices:\n  web:\n    image: nginx\n`;
}

describe('YAML accountability via scanRepo() (the real worker path)', () => {
  for (const keys of [8000, 20000]) {
    test(`a ${keys}-key single-line flow map is rejected as too-many-entries, with a finding, not silently dropped`, async () => {
      const dir = withTempRepo({ 'docker-compose.yml': floodCompose(keys) });
      try {
        const start = Date.now();
        const bundle = await scanRepo(dir, { timeoutMs: SCAN_TIMEOUT_MS });
        const elapsedMs = Date.now() - start;

        assert.ok(elapsedMs < SCAN_TIMEOUT_MS, `expected well under the scan deadline, took ${elapsedMs}ms`);
        assert.deepStrictEqual(bundle.evidence, []);
        assert.deepStrictEqual(bundle.findings, [{ kind: 'yaml-rejected', path: 'docker-compose.yml', reason: 'too-many-entries' }]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('a 200-key flow map (well within the entry cap) still yields the "web" service, no finding', async () => {
    const dir = withTempRepo({ 'docker-compose.yml': floodCompose(200) });
    try {
      const bundle = await scanRepo(dir, { timeoutMs: SCAN_TIMEOUT_MS });
      assert.ok(bundle.evidence.some(e => e.kind === 'compose-service' && e.value === 'web'));
      assert.deepStrictEqual(bundle.findings, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a syntactically invalid compose file (an unclosed "[") gives a parse-error finding, not a silent drop', async () => {
    const dir = withTempRepo({ 'docker-compose.yml': 'services:\n  web:\n    image: [nginx\n' });
    try {
      const bundle = await scanRepo(dir, { timeoutMs: SCAN_TIMEOUT_MS });
      assert.deepStrictEqual(bundle.evidence, []);
      assert.deepStrictEqual(bundle.findings, [{ kind: 'yaml-rejected', path: 'docker-compose.yml', reason: 'parse-error' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a compose file truncated mid-line either parses or reports parse-error, and never silences a sibling file', async () => {
    // The truncated file alone has no valid `services:`/`image:` shape
    // to extract evidence from either way, so the meaningful assertion
    // is that a SECOND, healthy compose file in the same repo is still
    // fully processed -- one broken file must not swallow the others.
    const dir = withTempRepo({
      'broken/docker-compose.yml': 'services:\n  web:\n    ima',
      'healthy/docker-compose.yml': 'services:\n  api:\n    image: nginx\n',
    });
    try {
      const bundle = await scanRepo(dir, { timeoutMs: SCAN_TIMEOUT_MS });
      assert.ok(bundle.evidence.some(e => e.kind === 'compose-service' && e.value === 'api' && e.path === 'healthy/docker-compose.yml'));
      // The broken file: either it was rejected with a finding, or it
      // parsed (silently as a document with no compose-service key) --
      // both are acceptable per the fix requirement. What is NOT
      // acceptable is an unhandled throw or a hang, both already ruled
      // out by scanRepo() resolving at all.
      const brokenFinding = bundle.findings.find(f => f.path === 'broken/docker-compose.yml');
      if (brokenFinding) assert.strictEqual(brokenFinding.reason, 'parse-error');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every *.yml/*.yaml file is accounted for by evidence or a finding, except files no parser targets (documented)', async () => {
    const dir = withTempRepo({
      'docker-compose.yml': 'services:\n  web:\n    image: nginx\n',
      '.github/workflows/ci.yml': 'jobs:\n  build:\n    runs-on: ubuntu-latest\n',
      // Not compose- or workflow-shaped by name: no custom parser looks
      // at this one. Documented, not a bug -- see the file-level comment.
      'config.yml': 'app:\n  name: example\n  timeout: 30\n',
      // Compose-named, but hostile: must be accounted for by a finding.
      'nested/docker-compose.override.yml': floodCompose(9000),
    });
    try {
      const bundle = await scanRepo(dir, { timeoutMs: SCAN_TIMEOUT_MS });

      const targeted = ['docker-compose.yml', '.github/workflows/ci.yml', 'nested/docker-compose.override.yml'];
      for (const targetPath of targeted) {
        const hasEvidence = bundle.evidence.some(e => e.path === targetPath);
        const hasFinding = bundle.findings.some(f => f.path === targetPath);
        assert.ok(hasEvidence || hasFinding, `expected evidence or a finding referencing "${targetPath}"`);
      }

      // config.yml: not compose- or workflow-shaped, no custom parser
      // targets it, and it has nothing stack-analyser's own rules
      // recognise either -- documented as the "no parser targets this"
      // case, not asserted as a bug.
      assert.strictEqual(bundle.evidence.some(e => e.path === 'config.yml'), false);
      assert.strictEqual(bundle.findings.some(f => f.path === 'config.yml'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
