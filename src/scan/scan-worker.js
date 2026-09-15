// Worker-thread entry point for scanPath(), used by scanRepo()'s hard
// scan deadline (see scan-timeout.js). This file's only job is to run
// scanPath() in complete isolation from the main thread and report the
// result back -- so that if something deep inside a dependency (stack-
// analyser, or a future one) ever hangs on CPU-bound work that no
// Promise-based timeout could interrupt, terminating this worker is
// still guaranteed to free the main thread.
//
// Only plain, structured-cloneable data crosses this boundary in either
// direction: `workerData` in (a repo path string and two plain options
// objects -- never a function, a Provider instance, or anything else
// non-transferable) and a plain `{ ok, bundle }` / `{ ok: false,
// message }` object out via postMessage. Nothing here shares memory
// with the caller.

const { workerData, parentPort } = require('node:worker_threads');
const { scanPath } = require('./scan');

(async () => {
  try {
    const { repoPath, meta, providerOptions } = workerData;
    const bundle = await scanPath(repoPath, meta, providerOptions);
    parentPort.postMessage({ ok: true, bundle });
  } catch (err) {
    parentPort.postMessage({ ok: false, message: err && err.message ? err.message : String(err) });
  }
})();
