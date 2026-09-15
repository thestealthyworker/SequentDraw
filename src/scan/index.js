// Public entry point for the git-map scan engine: acquire a repo (local
// path or GitHub URL), scan it through the safe provider, always clean
// up any temp clone, and return the evidence bundle.

const { resolveSource, cloneGitHub } = require('./acquire');
const { scanPath } = require('./scan');
const { scanWithTimeout, ScanTimeoutError, DEFAULT_SCAN_TIMEOUT_MS } = require('./scan-timeout');
const { checkEvidence } = require('./check-evidence');
const { SafeProvider } = require('./safe-provider');
const { CROSSWALK, lookup: lookupCrosswalk } = require('./crosswalk');

// Acquires `input` (a local path or GitHub URL), scans it, and always
// cleans up an acquired temp clone -- on success and on any failure
// while scanning, timeout included. `options` is split into acquire-only
// knobs (`tmpRoot`, `cloneTimeoutMs`, `maxCloneBytes`, `runGit`),
// provider limits (`maxFiles`, `maxDepth`, `maxFileBytes`,
// `maxTotalBytes`), and scan-deadline knobs:
//   - `timeoutMs` (default 60000): the scan step's hard deadline,
//     enforced by running it in a worker_threads Worker and terminating
//     that worker if it is exceeded (see scan-timeout.js) -- a
//     CPU-bound hang inside a dependency cannot be interrupted any other
//     way. On timeout the returned promise rejects with a
//     ScanTimeoutError (`err.code === 'scan-timeout'`).
//   - `inProcess` (default false): skip the Worker and call scanPath()
//     directly on the main thread. For unit tests only -- this trades
//     away the hard-kill guarantee for lower overhead and simpler
//     debugging, and does not itself enforce `timeoutMs`.
//   - `scanWorkerPath`: overrides which worker script scanWithTimeout()
//     runs. Test-only; lets a test point this at a script that
//     deliberately never responds, to exercise the timeout/cleanup path
//     without needing the real scan pipeline to hang on demand.
async function scanRepo(input, options = {}) {
  const source = await resolveSource(input);

  async function runScan(repoPath, meta) {
    if (options.inProcess) {
      return scanPath(repoPath, meta, providerOptions(options));
    }
    return scanWithTimeout(
      repoPath,
      meta,
      providerOptions(options),
      options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
      options.scanWorkerPath,
    );
  }

  if (source.type === 'local') {
    return runScan(source.path, { name: source.name, source: 'local', ref: null });
  }

  const clone = await cloneGitHub(
    { owner: source.owner, repo: source.repo, ref: source.ref },
    {
      tmpRoot: options.tmpRoot,
      timeoutMs: options.cloneTimeoutMs,
      maxBytes: options.maxCloneBytes,
      runGit: options.runGit,
    },
  );

  try {
    return await runScan(clone.path, { name: source.name, source: 'github', ref: clone.ref });
  } finally {
    await clone.cleanup();
  }
}

function providerOptions(options) {
  const out = {};
  for (const key of ['maxFiles', 'maxDepth', 'maxFileBytes', 'maxTotalBytes']) {
    if (options[key] != null) out[key] = options[key];
  }
  return out;
}

module.exports = {
  scanRepo,
  resolveSource,
  cloneGitHub,
  scanPath,
  scanWithTimeout,
  ScanTimeoutError,
  DEFAULT_SCAN_TIMEOUT_MS,
  checkEvidence,
  SafeProvider,
  CROSSWALK,
  lookupCrosswalk,
};
