// End-to-end scan of the "hostile" fixture (docs/design/git-map.md
// section 6): symlink loop, a link outside the repo, an oversized file, a
// binary file, a real .env with a fake secret, a minified bundle,
// zero-width characters in a filename, prompt-injection text in prose and
// in a comment, a YAML alias bomb, and 25,000 empty files to trip the
// file-listing cap. Built into a temp dir at test time (see
// tests/fixtures/build-hostile-repo.js) -- never committed.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { scanPath } = require('../src/scan/scan');
const { makeTempHostileRepo } = require('./fixtures/build-hostile-repo');
const { MANY_FILES_COUNT } = require('./fixtures/build-hostile-repo');

describe('hostile fixture: safety properties', () => {
  let dir;
  let bundle;
  let dump;
  let elapsedMs;

  before(async () => {
    dir = await makeTempHostileRepo();
    const start = Date.now();
    bundle = await scanPath(dir, { name: 'hostile', source: 'local', ref: null });
    elapsedMs = Date.now() - start;
    dump = JSON.stringify(bundle);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('finishes in under 10 seconds', () => {
    assert.ok(elapsedMs < 10000, `scan took ${elapsedMs}ms`);
  });

  test('no secret value appears anywhere in the serialised bundle', () => {
    assert.strictEqual(dump.includes('AKIAFAKESECRETVALUE'), false);
    assert.strictEqual(dump.includes('hunter2'), false);
  });

  test('the real .env appears only as a real-env-file finding, by name, nowhere else', () => {
    const realEnvEvidence = bundle.evidence.filter(e => e.kind === 'real-env-file');
    assert.strictEqual(realEnvEvidence.length, 1);
    assert.strictEqual(realEnvEvidence[0].path, '.env');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(realEnvEvidence[0], 'value'), false);

    const findingsRealEnv = bundle.findings.filter(f => f.kind === 'real-env-file');
    assert.strictEqual(findingsRealEnv.length, 1);
    assert.strictEqual(findingsRealEnv[0].path, '.env');
  });

  test('no path outside the repo appears in the bundle, and symlinks are not followed', () => {
    assert.strictEqual(dump.includes(dir), false); // no absolute path leaks
    assert.strictEqual(dump.includes('etc-link'), false);
    assert.strictEqual(dump.includes('/etc/'), false);
    assert.strictEqual(dump.includes('dangling-link'), false);
    assert.strictEqual(dump.includes('loop/self'), false);
  });

  test('limits report truncation with a reason', () => {
    assert.strictEqual(bundle.limits.truncated, true);
    assert.ok(bundle.limits.reason && bundle.limits.reason.length > 0);
    assert.ok(bundle.limits.files <= 20000);
  });

  test('no injected text becomes a tech or evidence value beyond a harmless truncated string', () => {
    assert.strictEqual(dump.includes('pwned'), false);
    assert.strictEqual(dump.includes('IGNORE PREVIOUS INSTRUCTIONS'), false);
    for (const e of bundle.evidence) {
      if (typeof e.tech === 'string') assert.notStrictEqual(e.tech, 'pwned');
      if (typeof e.value === 'string') assert.notStrictEqual(e.value.toLowerCase(), 'pwned');
    }
  });

  test('the yaml alias bomb produced no evidence and did not hang the scan (bounded)', () => {
    const fromBombFile = bundle.evidence.filter(e => e.path === 'docker-compose.bomb.yml');
    assert.deepStrictEqual(fromBombFile, []);
  });

  test('the express sdk-import from src.js is still found despite the injected comment', () => {
    assert.ok(bundle.evidence.some(e => e.kind === 'sdk-import' && e.value === 'express' && e.path === 'src.js'));
  });

  test('output is byte-identical across two scans of the same hostile repo', async () => {
    const again = await scanPath(dir, { name: 'hostile', source: 'local', ref: null });
    assert.deepStrictEqual(bundle, again);
  });

  test('the many/ directory really did contain enough files to exercise the cap', () => {
    assert.ok(MANY_FILES_COUNT > 20000);
  });
});
