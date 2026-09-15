// The hard scan deadline (fix round 2, item 1(c)): scanWithTimeout()
// runs scanPath() inside a worker_threads Worker and terminates it if
// `timeoutMs` is exceeded -- the one mechanism that can actually
// reclaim control from a CPU-bound hang no Promise-based timeout could
// interrupt. scanRepo() wires this in by default, with `inProcess` as
// an escape hatch for tests and `scanWorkerPath` as a test-only hook so
// the termination/cleanup path can be exercised without needing the
// real scan pipeline to hang on demand.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanWithTimeout, ScanTimeoutError, DEFAULT_SCAN_TIMEOUT_MS } = require('../src/scan/scan-timeout');
const { scanRepo } = require('../src/scan/index');

const STALLING_WORKER = path.resolve(__dirname, 'fixtures', 'stalling-scan-worker.js');
const COMPOSE_FIXTURE = path.resolve(__dirname, 'fixtures', 'repos', 'compose-app');

describe('scanWithTimeout', () => {
  test('a normal, fast scan resolves with the bundle before the deadline', async () => {
    const bundle = await scanWithTimeout(COMPOSE_FIXTURE, { name: 'compose-app', source: 'local', ref: null }, {}, 30000);
    assert.strictEqual(bundle.repo.name, 'compose-app');
    assert.ok(bundle.evidence.length > 0);
  });

  test('a worker that never responds is terminated at the deadline and rejects with a ScanTimeoutError', async () => {
    const start = Date.now();
    await assert.rejects(
      () => scanWithTimeout('/does-not-matter', { name: 'x', source: 'local', ref: null }, {}, 300, STALLING_WORKER),
      err => {
        assert.ok(err instanceof ScanTimeoutError);
        assert.strictEqual(err.code, 'scan-timeout');
        return true;
      },
    );
    const elapsedMs = Date.now() - start;
    // Generous upper bound (this machine can be noisy under full-suite
    // or multi-agent load): the point under test is that the worker is
    // actually killed rather than left running indefinitely, not that
    // termination is instantaneous.
    assert.ok(elapsedMs < 15000, `expected termination well under 15s, took ${elapsedMs}ms`);
  });

  test('DEFAULT_SCAN_TIMEOUT_MS is 60 seconds', () => {
    assert.strictEqual(DEFAULT_SCAN_TIMEOUT_MS, 60000);
  });
});

describe('scanRepo: the deadline applies end to end, with cleanup', () => {
  test('local source: a stalled scan rejects with scan-timeout', async () => {
    await assert.rejects(
      () =>
        scanRepo(COMPOSE_FIXTURE, {
          timeoutMs: 300,
          scanWorkerPath: STALLING_WORKER,
        }),
      err => {
        assert.strictEqual(err.code, 'scan-timeout');
        return true;
      },
    );
  });

  test('github source: a stalled scan rejects with scan-timeout AND the temp clone is removed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-timeout-test-'));
    let clonedDir = null;

    // A fake runGit that behaves like a successful clone: it creates the
    // target directory's content so cloneGitHub() succeeds normally and
    // returns a real temp directory for scanWithTimeout() to (fail to)
    // scan and for the surrounding `finally` in scanRepo() to clean up.
    const runGit = async (args, opts) => {
      clonedDir = opts.cwd;
      if (args.includes('clone') || args.includes('init')) {
        fs.mkdirSync(opts.cwd, { recursive: true });
        fs.writeFileSync(path.join(opts.cwd, 'package.json'), '{}');
      }
      if (args.includes('rev-parse')) {
        return { code: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: '', timedOut: false };
      }
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    };

    try {
      await assert.rejects(
        () =>
          scanRepo('https://github.com/example-owner/example-repo', {
            tmpRoot,
            runGit,
            timeoutMs: 300,
            scanWorkerPath: STALLING_WORKER,
          }),
        err => {
          assert.strictEqual(err.code, 'scan-timeout');
          return true;
        },
      );

      assert.ok(clonedDir, 'runGit should have been invoked with a working directory');
      assert.strictEqual(fs.existsSync(clonedDir), false, 'the temp clone must be removed even after a scan timeout');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('inProcess: true bypasses the worker and still returns a correct bundle', async () => {
    const bundle = await scanRepo(COMPOSE_FIXTURE, { inProcess: true });
    assert.strictEqual(bundle.repo.source, 'local');
    assert.ok(bundle.evidence.some(e => e.kind === 'compose-service'));
  });
});
