// Detects what this running copy of the package is: where it lives, what
// version it says it is, and whether it is running from a temporary `npx`
// cache rather than a stable install. `skills install` needs all three to
// decide the one engine command a copied skill should name literally --
// see rewrite-cli-pipeline.js.

const fs = require('fs');
const path = require('path');

// npx extracts a package under a directory segment literally named
// "_npx" (e.g. ~/.npm/_npx/<hash>/node_modules/sequentdraw) on every
// platform npx runs on. That segment is what "running from an npx cache"
// means here -- nothing about the rest of the path is inspected.
const NPX_CACHE_SEGMENT = '_npx';

function isRunningFromNpxCache(packageRoot) {
  return packageRoot.split(path.sep).includes(NPX_CACHE_SEGMENT);
}

// `packageRoot` is the directory that directly contains `bin/`, `src/`,
// `schema/`, `skills/` and this package's own `package.json` -- the
// caller resolves it (normally two levels above `src/cli/skills.js`) so
// this function stays a pure reader, easy to point at a fixture in tests.
function detectRuntime(packageRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  return {
    packageRoot,
    version: pkg.version,
    isNpx: isRunningFromNpxCache(packageRoot),
  };
}

module.exports = { detectRuntime, isRunningFromNpxCache, NPX_CACHE_SEGMENT };
