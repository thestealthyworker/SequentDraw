// The scan step: runs @specfy/stack-analyser (technology + dependency
// detection) and SequentDraw's own small parsers (compose, workflow,
// manifests, SDK imports, routes, env names) against an already-acquired
// local directory, through the SafeProvider, and assembles the evidence
// bundle.
//
// This module never touches the network and never executes anything in
// the scanned repository: stack-analyser's rules are static regex/JSON
// matchers, and every parser here is regex/JSON-parse over text handed
// back by SafeProvider -- nothing here calls eval, require()s a path
// inside the scanned repo, or shells out.

const path = require('node:path');

const { SafeProvider } = require('./safe-provider');
const { assembleEvidence, mapStackAnalyserDependencies } = require('./evidence');
const { parseCompose } = require('./parsers/compose-parser');
const { parseWorkflow } = require('./parsers/workflow-parser');
const { parsePackageJson, parseRequirementsTxt } = require('./parsers/manifest-parser');
const { parseImports } = require('./parsers/import-parser');
const { parseRoute } = require('./parsers/route-parser');
const { parseEnvNames } = require('./parsers/env-parser');

// stack-analyser is an ESM package (package.json "type": "module"), so it
// is loaded with a dynamic import() from this CommonJS module. Its
// logger (`consola`) is silenced by grabbing the shared `l` instance from
// its own log module *before* the rest of the package (which imports the
// same module and gets the same singleton) ever logs anything, and rule
// registration ("autoload") is a required side-effecting import: without
// it, `rules.list` is empty and the analyser finds nothing (see the
// investigation in this PR's scan.js history / CREDITS.md).
let stackAnalyserModulesPromise = null;
function loadStackAnalyser() {
  if (!stackAnalyserModulesPromise) {
    stackAnalyserModulesPromise = (async () => {
      const { l } = await import('@specfy/stack-analyser/dist/common/log.js');
      l.level = -999; // consola: below the lowest real level, so nothing logs
      await import('@specfy/stack-analyser/dist/autoload.js');
      const { analyser } = await import('@specfy/stack-analyser');
      return { analyser };
    })();
  }
  return stackAnalyserModulesPromise;
}

const COMPOSE_FILE_RE = /(^|\/)docker-compose[^/]*\.ya?ml$/i;
const WORKFLOW_FILE_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const JS_TS_RE = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const PY_RE = /\.py$/i;
const ENV_FILE_RE = /(^|\/)\.env(\.|$)/i;

// Recursively collects every file path the SafeProvider is willing to
// list (directories/files it skips -- node_modules, symlinks, files past
// the listing cap -- never appear here, because listDir() already
// enforces that). Returns absolute paths.
async function collectFiles(provider, dirPath, out) {
  const entries = await provider.listDir(dirPath);
  for (const entry of entries) {
    if (entry.type === 'dir') {
      await collectFiles(provider, entry.fp, out);
    } else {
      out.push(entry.fp);
    }
  }
  return out;
}

// Runs every custom parser against the files the walk found. Returns raw
// (id-less) evidence records.
async function runCustomParsers(provider, absolutePaths) {
  const records = [];

  for (const absPath of absolutePaths) {
    const relPath = provider.relPath(absPath);
    const basename = path.basename(relPath);

    // Route detection is a pure filename-convention match: no content
    // needed, and it must run even for files the provider would
    // otherwise refuse to open (it never does for .ts/.js source, but
    // keeping this content-independent keeps the rule simple).
    if (JS_TS_RE.test(relPath)) {
      records.push(...parseRoute(relPath));
    }

    if (ENV_FILE_RE.test(basename)) {
      // Always call open(): for a real .env* file this returns null and
      // (as a side effect) records the real-env-file finding; for the
      // three safe example names it returns the value-stripped content.
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseEnvNames(relPath, content));
      continue;
    }

    if (COMPOSE_FILE_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseCompose(relPath, content));
      continue;
    }

    if (WORKFLOW_FILE_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseWorkflow(relPath, content));
      continue;
    }

    if (basename === 'package.json') {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parsePackageJson(relPath, content));
      continue;
    }

    if (basename === 'requirements.txt') {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseRequirementsTxt(relPath, content));
      continue;
    }

    if (JS_TS_RE.test(relPath) || PY_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseImports(relPath, content));
    }
  }

  return records;
}

// Scans an already-acquired local directory and returns the evidence
// bundle. `meta` carries what the caller already knows about the source
// (acquire.js resolves this): { name, source: 'local'|'github', ref }.
// `ref` is whatever the caller already resolved (the cloned commit SHA
// for a GitHub source); scan.js never independently probes a directory's
// git ancestry for a ref, so a local scan never reports the SHA of some
// unrelated enclosing repository the folder happens to sit inside.
async function scanPath(repoPath, meta, providerOptions = {}) {
  const provider = new SafeProvider({ path: repoPath, ...providerOptions });

  // Our own walk runs FIRST, deliberately. Both this walk and
  // stack-analyser's own internal traversal share one SafeProvider, and
  // therefore one cumulative files-listed budget (provider.filesListed):
  // whichever walk runs first gets first claim on it. Our own parsers are
  // what find the real-env-file finding, docker-compose/workflow/env/SDK
  // evidence -- the facts this engine treats as load-bearing -- so they
  // must not be starved by stack-analyser's traversal order happening to
  // dive into a huge, low-value subtree (node_modules-shaped noise, or a
  // hostile repo's own flood of files) before reaching them. Running
  // second, stack-analyser still contributes whatever manifest ecosystems
  // we did not write a bespoke parser for, for whatever budget remains.
  const allFiles = await collectFiles(provider, provider.basePath, []);
  const customRecords = await runCustomParsers(provider, allFiles);

  const { analyser } = await loadStackAnalyser();
  const payload = await analyser({ provider });
  const tree = payload.toJson(provider.basePath);
  const dependencyRecords = mapStackAnalyserDependencies(tree);

  const realEnvRecords = provider.findings
    .filter(f => f.kind === 'real-env-file')
    .map(f => ({ kind: 'real-env-file', path: f.path, line: null }));

  const evidence = assembleEvidence([...customRecords, ...dependencyRecords, ...realEnvRecords]);

  return {
    repo: { name: meta.name, source: meta.source, ref: meta.ref || null },
    limits: {
      files: provider.filesListed,
      bytes: provider.bytesOpened,
      truncated: provider.truncated,
      reason: provider.reason,
    },
    findings: provider.findings.map(f => ({ ...f })),
    evidence,
  };
}

module.exports = { scanPath, collectFiles, runCustomParsers, loadStackAnalyser };
