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
const { spawnSync } = require('node:child_process');

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

describe('a worker is not killed the moment it answers', () => {
  // Terminating a thread that has just posted its result can tear down a
  // native handle it is still finishing with. Node asserts rather than
  // unwinding when that happens:
  //
  //   Assertion failed: init_done_ && "close before init"  node_zlib.cc:402
  //   FATAL ERROR: v8::HandleScope::CreateHandle() ...
  //
  // in Worker::Run() -> Realm::RunCleanup(). That is a fatal error in the
  // whole process AFTER a successful scan. It was found in CI, on both Node
  // 20 and 22, because the race only widens under load.
  const LINGERING_WORKER = path.resolve(__dirname, 'fixtures', 'lingering-scan-worker.js');

  test('a worker that answers and then lingers still resolves, and is not terminated to do it', async () => {
    const bundle = await scanWithTimeout('/unused', {}, {}, 30000, LINGERING_WORKER);
    assert.deepStrictEqual(bundle, { evidence: [], repo: { source: 'local' } });
  });

  test('a lingering worker cannot hold the process open', async () => {
    // The real assertion is that this child EXITS. An unreferenced worker
    // does not keep the event loop alive, so the process ends as soon as
    // its own work is done -- without waiting out the grace period, and
    // without terminate() being what ends it.
    const script = `
      const { scanWithTimeout } = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'scan', 'scan-timeout.js'))});
      scanWithTimeout('/unused', {}, {}, 30000, ${JSON.stringify(LINGERING_WORKER)})
        .then(() => console.log('resolved'))
        .catch(err => { console.error(err.message); process.exitCode = 1; });
    `;
    const started = Date.now();
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /resolved/);
    // Comfortably under GRACE_MS (5s) plus startup: the process is not
    // waiting for the sweep, it is simply free to leave.
    assert.ok(Date.now() - started < 15000, `took ${Date.now() - started}ms`);
  });
});
