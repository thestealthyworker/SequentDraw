// A hard deadline around the scan step, as a backstop against any
// future library complexity: even a CPU-bound hang deep inside a
// dependency (stack-analyser, or whatever replaces/joins it later)
// cannot be interrupted by a Promise-based timeout alone -- a single
// synchronous call that never returns blocks the event loop, so no
// timer callback runs until it does. worker_threads.Worker#terminate()
// is the one mechanism that actually reclaims control regardless: it
// kills the whole isolated thread, synchronous work and all.
//
// scanWithTimeout() runs scanPath() (via scan-worker.js) inside a fresh
// Worker and races it against `timeoutMs`. On timeout the worker is
// terminated and the returned promise rejects with a ScanTimeoutError
// (`.code === 'scan-timeout'`); the caller (scanRepo(), in index.js) is
// what cleans up any acquired temp clone, in a `finally` around this
// call, so a timeout never leaks one.

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_SCAN_TIMEOUT_MS = 60000;
const DEFAULT_WORKER_PATH = path.join(__dirname, 'scan-worker.js');

class ScanTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`git-map: scan exceeded ${timeoutMs}ms and was terminated.`);
    this.name = 'ScanTimeoutError';
    this.code = 'scan-timeout';
  }
}

// `workerPath` is injectable (defaults to the real scan-worker.js)
// purely so tests can point this at a tiny stand-in script that
// deliberately never responds, to exercise the termination/cleanup path
// without needing to make the real scan pipeline hang on demand.
function scanWithTimeout(repoPath, meta, providerOptions, timeoutMs = DEFAULT_SCAN_TIMEOUT_MS, workerPath = DEFAULT_WORKER_PATH) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;

    try {
      worker = new Worker(workerPath, {
        workerData: { repoPath, meta, providerOptions },
      });
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker
        .terminate()
        .catch(() => {})
        .finally(() => reject(new ScanTimeoutError(timeoutMs)));
    }, timeoutMs);
    // A pending timer must never keep the process alive on its own --
    // the Worker itself already does that while real work is in flight.
    if (typeof timer.unref === 'function') timer.unref();

    worker.once('message', msg => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (msg && msg.ok) resolve(msg.bundle);
      else reject(new Error((msg && msg.message) || 'git-map: scan worker failed with no message.'));
    });

    worker.once('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    worker.once('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`git-map: scan worker exited unexpectedly (code ${code}).`));
    });
  });
}

module.exports = { scanWithTimeout, ScanTimeoutError, DEFAULT_SCAN_TIMEOUT_MS, DEFAULT_WORKER_PATH };
