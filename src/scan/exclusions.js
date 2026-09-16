// Relevance policy: decides which paths in a scanned repository describe
// THE PRODUCT, and which only describe how the product is tested or
// demonstrated.
//
// Why this exists (CTO-M1-01): scanning SequentDraw's own checkout
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

'use strict';

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
// the voting-app bundle (CTO-M1-05) -- "docker-compose.test.yml".
// Requires dots on BOTH sides, so "latest.json" is not a test file.
const TEST_FILE_RE = /\.(?:test|spec)\./i;

// Hard caps: the manifests these roots come from are untrusted repository
// content, so a hostile package.json cannot make the policy hold an
// unbounded set of strings, nor make each one unbounded in length.
const MAX_PRODUCT_ROOTS = 500;
const MAX_ROOT_LENGTH = 200;

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
}

// The permissive policy used when no manifest could be read: still skips
// conventional test directories, but has no product roots to rescue with.
const DEFAULT_POLICY = new RelevancePolicy([]);

module.exports = {
  RelevancePolicy,
  DEFAULT_POLICY,
  productRootsFromPackageJson,
  productRootsFromCompose,
  normalise,
  literalPrefix,
  TEST_SEGMENTS,
  AMBIGUOUS_SEGMENTS,
  MAX_PRODUCT_ROOTS,
};
