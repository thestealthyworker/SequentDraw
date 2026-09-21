// A worker that posts a successful result and then stays alive, to prove
// scanWithTimeout() does not depend on killing a worker to settle -- and
// that an unreferenced lingering worker cannot hold the process open.
//
// Terminating a worker the instant it posts its result is what crashed the
// process in CI (node_zlib.cc:402, "close before init", during
// Realm::RunCleanup), so the success path must not do it.
const { parentPort } = require('node:worker_threads');

parentPort.postMessage({ ok: true, bundle: { evidence: [], repo: { source: 'local' } } });

// Hold the worker's own event loop open well past the grace period.
setInterval(() => {}, 1000);
