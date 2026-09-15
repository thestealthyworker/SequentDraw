// Public entry point for the git-map scan engine: acquire a repo (local
// path or GitHub URL), scan it through the safe provider, always clean
// up any temp clone, and return the evidence bundle.

const { resolveSource, cloneGitHub } = require('./acquire');
const { scanPath } = require('./scan');
const { checkEvidence } = require('./check-evidence');
const { SafeProvider } = require('./safe-provider');
const { CROSSWALK, lookup: lookupCrosswalk } = require('./crosswalk');

// Acquires `input` (a local path or GitHub URL), scans it, and always
// cleans up an acquired temp clone -- on success and on any failure
// while scanning. `options` is split into acquire-only knobs
// (`tmpRoot`, `cloneTimeoutMs`, `maxCloneBytes`, `runGit`) and provider
// limits (`maxFiles`, `maxDepth`, `maxFileBytes`, `maxTotalBytes`),
// forwarded to cloneGitHub() / SafeProvider respectively.
async function scanRepo(input, options = {}) {
  const source = await resolveSource(input);

  if (source.type === 'local') {
    return scanPath(source.path, { name: source.name, source: 'local', ref: null }, providerOptions(options));
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
    return await scanPath(clone.path, { name: source.name, source: 'github', ref: clone.ref }, providerOptions(options));
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
  checkEvidence,
  SafeProvider,
  CROSSWALK,
  lookupCrosswalk,
};
