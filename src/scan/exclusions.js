// Relevance policy: decides which paths in a scanned repository describe
// THE PRODUCT, and which only describe how the product is tested or
// demonstrated.
//
// Why this exists (#27): scanning SequentDraw's own checkout
// produced 69 evidence entries, 54 of them from `tests/fixtures/repos/*`
// and `evals/*` -- three synthetic fixture apps that are not SequentDraw.
// `check --evidence` passed that map, because the evidence was real; it
// was just evidence about someone else's `web/api/worker/postgres/redis`.
// A founder scanning their own repo got a picture of our test data.
//
// The rule, deliberately narrow, is: a path is skipped when its own
// directory name is a conventional test/fixture name AND nothing the
// repository's own manifests point at lives there. A real user's
// `examples/` directory may genuinely BE their product, so names in that
// weaker class are treated as AMBIGUOUS: still skipped, but recorded with
// `ambiguous: true` so the skill can tell the user what it left out and
// offer to include it. Nothing is ever dropped silently -- every decision
// becomes an entry in the bundle's `exclusions` array, following the
// `yaml-rejected` precedent in safe-provider.js.
//
// The second rule here (issue #34) is not about names at all: a directory
// that is ITSELF another repository is where this repository stops. Scanning
// a checkout carrying four `.claude/worktrees/agent-*` copies gave 80
// evidence entries against a clean export's 16, drawing every component five
// times -- the walk descended into each worktree and excluded that copy's own
// `tests/`, never the worktree itself. Same class as #27: real
// evidence, wrong subject. The test is the `.git` entry a repository plants
// at its own root, so it covers a vendored clone and a submodule too, which a
// rule about the name `.claude/worktrees` would miss.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Directory names that conventionally hold tests or test data. A
// directory with one of these names is skipped unless a manifest points
// into it.
const TEST_SEGMENTS = new Set([
  '__tests__',
  '__mocks__',
  '__fixtures__',
  '__snapshots__',
  'test',
  'tests',
  'spec',
  'specs',
  'testdata',
  'test-data',
  'test_data',
  'fixture',
  'fixtures',
  'e2e',
  'eval',
  'evals',
  'benchmark',
  'benchmarks',
]);

// Weaker signals: these names OFTEN mean "not the product", but a
// gallery repo, a component library or a template repo may ship its
// `examples/` as the actual deliverable. Skipped, but flagged ambiguous
// so the skill surfaces the choice to the user rather than deciding
// silently on their behalf.
const AMBIGUOUS_SEGMENTS = new Set([
  'example',
  'examples',
  'sample',
  'samples',
  'demo',
  'demos',
  'playground',
]);

// A file whose basename carries a ".test." or ".spec." segment:
// "server.test.js", and -- the case that leaked false compose facts into
// the voting-app bundle (#27) -- "docker-compose.test.yml".
// Requires dots on BOTH sides, so "latest.json" is not a test file.
const TEST_FILE_RE = /\.(?:test|spec)\./i;

// Hard caps: the manifests these roots come from are untrusted repository
// content, so a hostile package.json cannot make the policy hold an
// unbounded set of strings, nor make each one unbounded in length.
const MAX_PRODUCT_ROOTS = 500;
const MAX_ROOT_LENGTH = 200;

// The marker a repository plants at its own root. A DIRECTORY is a clone; a
// FILE whose content begins "gitdir:" is a linked worktree or a submodule --
// git writes exactly that pointer for both.
const GIT_MARKER_NAME = '.git';

// Anchored at the start, so a file that merely MENTIONS a gitdir pointer
// somewhere in its prose is not mistaken for one.
const GITDIR_POINTER_RE = /^\s*gitdir\s*:/i;

// A gitdir pointer is a single short line. Nothing larger can be one, so
// nothing larger is ever read: a hostile repo cannot make this probe pull an
// arbitrarily large file into memory just by naming it `.git`.
const MAX_GIT_POINTER_BYTES = 4096;

function normalise(rel) {
  if (typeof rel !== 'string') return '';
  let out = rel.split('\\').join('/');
  out = out.replace(/^\.\//, '');
  while (out.startsWith('/')) out = out.slice(1);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function segmentsOf(rel) {
  return normalise(rel).split('/').filter(Boolean);
}

// Cuts a glob pattern down to its literal directory prefix:
// "examples/*" -> "examples", "packages/**/src" -> "packages".
function literalPrefix(pattern) {
  if (typeof pattern !== 'string') return '';
  const globIndex = pattern.search(/[*?{[]/);
  const literal = globIndex === -1 ? pattern : pattern.slice(0, globIndex);
  return normalise(literal);
}

function addRoot(roots, value) {
  const root = literalPrefix(value);
  if (!root || root.length > MAX_ROOT_LENGTH) return;
  if (roots.length >= MAX_PRODUCT_ROOTS) return;
  roots.push(root);
}

// Collects the paths a package.json itself claims are the package: its
// published `files`, its `main`/`module`/`types` entry, each `bin`
// target, each `exports` target and each workspace root. These are the
// repository saying, in its own manifest, "this is the thing I am".
function productRootsFromPackageJson(text) {
  const roots = [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return roots;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return roots;

  for (const key of ['main', 'module', 'types', 'typings']) {
    if (typeof doc[key] === 'string') addRoot(roots, doc[key]);
  }

  if (Array.isArray(doc.files)) {
    for (const entry of doc.files.slice(0, MAX_PRODUCT_ROOTS)) addRoot(roots, entry);
  }

  if (typeof doc.bin === 'string') addRoot(roots, doc.bin);
  else if (doc.bin && typeof doc.bin === 'object' && !Array.isArray(doc.bin)) {
    for (const value of Object.values(doc.bin).slice(0, MAX_PRODUCT_ROOTS)) addRoot(roots, value);
  }

  const workspaces = Array.isArray(doc.workspaces)
    ? doc.workspaces
    : doc.workspaces && Array.isArray(doc.workspaces.packages)
      ? doc.workspaces.packages
      : [];
  for (const entry of workspaces.slice(0, MAX_PRODUCT_ROOTS)) addRoot(roots, entry);

  collectExportTargets(doc.exports, roots, 0);

  return roots;
}

// `exports` is a nested map whose leaves are paths. Depth-bounded so a
// hostile manifest cannot drive unbounded recursion.
function collectExportTargets(node, roots, depth) {
  if (depth > 6 || roots.length >= MAX_PRODUCT_ROOTS) return;
  if (typeof node === 'string') {
    addRoot(roots, node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const value of Object.values(node).slice(0, 100)) {
    collectExportTargets(value, roots, depth + 1);
  }
}

// A compose service's `build` context is the strongest possible statement
// that a directory is part of the product: the repository builds an image
// out of it.
function productRootsFromCompose(doc) {
  const roots = [];
  if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') {
    return roots;
  }
  for (const service of Object.values(doc.services).slice(0, MAX_PRODUCT_ROOTS)) {
    if (!service || typeof service !== 'object') continue;
    const build = service.build;
    if (typeof build === 'string') addRoot(roots, build);
    else if (build && typeof build === 'object' && typeof build.context === 'string') {
      addRoot(roots, build.context);
    }
  }
  return roots;
}

// Probes ONE directory for a repository boundary and says which kind it is,
// or null for "not a boundary".
//
// The probe never follows a symlink: the marker is lstat-ed, and a symlinked
// `.git` is declined rather than resolved, so a scanned repository cannot use
// one to have a file outside the tree read on its behalf. Nothing is
// executed, and the only file ever opened is a `.git` small enough to be a
// pointer.
async function detectRepositoryBoundary(absDir) {
  if (typeof absDir !== 'string' || absDir.length === 0) return null;
  const marker = path.join(absDir, GIT_MARKER_NAME);

  let stats;
  try {
    stats = await fsp.lstat(marker);
  } catch {
    return null; // no marker at all: the common case
  }

  if (stats.isSymbolicLink()) return null; // never followed, in either direction
  if (stats.isDirectory()) return 'nested-repository';
  if (!stats.isFile()) return null; // device files, sockets, fifos
  if (stats.size > MAX_GIT_POINTER_BYTES) return null;

  let text;
  try {
    text = await fsp.readFile(marker, 'utf8');
  } catch {
    return null;
  }

  return GITDIR_POINTER_RE.test(text) ? 'nested-worktree' : null;
}

class RelevancePolicy {
  constructor(productRoots = []) {
    const seen = new Set();
    this.productRoots = [];
    for (const raw of productRoots) {
      const root = normalise(raw);
      if (!root || seen.has(root)) continue;
      seen.add(root);
      this.productRoots.push(root);
      if (this.productRoots.length >= MAX_PRODUCT_ROOTS) break;
    }
  }

  // A directory is rescued when it IS a manifest-named path, or when it
  // CONTAINS one ("examples" is kept when the manifest names
  // "examples/app"). Deliberately NOT "sits inside one": the voting app's
  // `result/` is a product root, but `result/tests/` inside it is still
  // tests, and that is exactly the directory whose
  // docker-compose.test.yml leaked `vote depends_on db` into the bundle.
  isProductPath(rel) {
    const r = normalise(rel);
    if (!r) return false;
    if (this.productRoots.includes(r)) return true;
    const prefix = `${r}/`;
    return this.productRoots.some(root => root.startsWith(prefix));
  }

  classifyDir(rel) {
    const segs = segmentsOf(rel);
    const name = (segs[segs.length - 1] || '').toLowerCase();
    if (!name) return null;

    if (TEST_SEGMENTS.has(name)) {
      if (this.isProductPath(rel)) return null;
      return { reason: 'test-directory', ambiguous: false };
    }
    if (AMBIGUOUS_SEGMENTS.has(name)) {
      if (this.isProductPath(rel)) return null;
      return { reason: 'example-directory', ambiguous: true };
    }
    return null;
  }

  classifyFile(rel) {
    const segs = segmentsOf(rel);
    const base = segs[segs.length - 1] || '';
    if (!base) return null;
    if (TEST_FILE_RE.test(base)) {
      if (this.isProductPath(rel)) return null;
      return { reason: 'test-file', ambiguous: false };
    }
    return null;
  }

  // What SafeProvider.listDir() calls for each entry it is about to
  // return. Returns null to keep the entry.
  classify(rel, type) {
    return type === 'dir' ? this.classifyDir(rel) : this.classifyFile(rel);
  }

  // Whether a directory the walk is about to enter is a DIFFERENT repository.
  // Async, unlike classifyDir/classifyFile, because a boundary is a fact on
  // disk rather than a fact about a path's name -- which is the point: it
  // catches a vendored clone and a submodule, neither of which is named in
  // any way a list of directory names could anticipate.
  //
  // Two directories are exempt, and both matter:
  //
  //   * The scan root. The root IS a repository, so an unguarded probe would
  //     skip it and scan nothing at all. This is not hypothetical: when
  //     SequentDraw is developed from a linked worktree, the root's own
  //     `.git` is a `gitdir:` pointer file -- the very shape being matched.
  //
  //   * A nested repository the manifest points at. A submodule used as a
  //     workspace package genuinely IS part of this product, and the
  //     repository's own statement about itself wins here exactly as it does
  //     for a test-named directory in classifyDir().
  //
  // Both checks run before the probe, so the common case costs no syscall.
  async classifyNestedRepository(rel, absDir) {
    const r = normalise(rel);
    if (!r || r === '.') return null;
    if (this.isProductPath(r)) return null;

    const kind = await detectRepositoryBoundary(absDir);
    return kind ? { reason: kind, ambiguous: false } : null;
  }
}

// The permissive policy used when no manifest could be read: still skips
// conventional test directories, but has no product roots to rescue with.
const DEFAULT_POLICY = new RelevancePolicy([]);

module.exports = {
  RelevancePolicy,
  DEFAULT_POLICY,
  detectRepositoryBoundary,
  productRootsFromPackageJson,
  productRootsFromCompose,
  normalise,
  literalPrefix,
  TEST_SEGMENTS,
  AMBIGUOUS_SEGMENTS,
  MAX_PRODUCT_ROOTS,
  MAX_GIT_POINTER_BYTES,
};
