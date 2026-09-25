// Dependency manifests for the ecosystems SequentDraw has no bespoke parser
// for: Go, Rust, Ruby, PHP, Deno, Terraform, and the `uses:`/container
// lines of GitHub Actions workflows.
//
// Vendored from @specfy/stack-analyser 1.27.6 (MIT; the licence is kept in
// LICENSE-stack-analyser beside this file) in build step 8a, so the package
// and its transitive tree could be dropped. npm ignores a dependency's
// `overrides`, so a published SequentDraw would otherwise have inherited
// that tree's advisories (docs/design/git-map.md, "Supply chain").
//
// SequentDraw only ever used stack-analyser's DEPENDENCY tuples -- never
// its technology detection, which is not citable evidence on its own. Those
// tuples come from eight small parsers, not from its 798 technology rules,
// and those eight are what is ported here. Two things were dropped rather
// than ported, because SequentDraw's own parsers already cover them with
// line numbers: npm and Python manifests (manifest-parser.js), and Compose
// files (compose-parser.js).
//
// Five defects in the original are fixed here, each covered by a test in
// tests/scan-dependency-manifests.test.js, and each found by recording what
// the original actually emitted on tests/fixtures/repos/polyglot:
//
//   1. Every record carries the manifest's own path. The original merged
//      "virtual" payloads into the root and lost the path, so a Go, Ruby,
//      Deno or Actions dependency was evidence that could not say which
//      file it came from.
//   2. An Actions job whose `container:` is an object is read as an image
//      name. The original destructured the string as though it were an
//      array, so `hashicorp/terraform` became the image "h", version "a".
//   3. A Terraform provider is reported once. The original emitted each
//      lockfile provider twice, once with no path.
//   4. A Gemfile entry is read with single quotes and with no version.
//      The original required double quotes and a comma, so `gem 'redis'`
//      and a bare `gem "sidekiq"` were never seen.
//   5. Every workflow file in a directory is read. The original stopped at
//      the first one it found.
//
// And one change of mechanism: Terraform is read with a small HCL reader
// here instead of a WebAssembly HCL-to-JSON parser. It needs only two
// shapes -- `provider "<name>" { version = "<v>" }` blocks in the lockfile
// and `resource "<type>" "<name>"` headers in a .tf file -- and comments are
// stripped first, so a commented-out resource is never reported.

const path = require('node:path');
const TOML = require('@iarna/toml');
const { parseYamlSafe } = require('../yaml-safe');
const { isKnownResourceType } = require('./terraform-resources');

// .tf files are skipped above this size, as they were before.
const MAX_TF_BYTES = 500000;

const WORKFLOW_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const TF_RE = /\.tf$/;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// "name:tag" -> [name, tag]. Split on the LAST colon after the last slash,
// so a registry with a port ("localhost:5000/tool:1") keeps its host.
function splitImage(image) {
  const text = String(image);
  const slash = text.lastIndexOf('/');
  const colon = text.lastIndexOf(':');
  if (colon > slash) return [text.slice(0, colon), text.slice(colon + 1)];
  return [text, ''];
}

// --- Go -----------------------------------------------------------------

// A tab-indented `module vX` line inside a require block. A trailing
// `// indirect` (or any other trailing text) is skipped: an indirect module
// is not something this repository chose.
const GO_LINE_RE = /^\t(\S+)\s+v(\S+)(.*)$/;

function parseGoMod(content) {
  const out = [];
  for (const line of content.split(/\r?\n/)) {
    const m = GO_LINE_RE.exec(line);
    if (!m) continue;
    if (m[3].trim() !== '') continue;
    out.push(['golang', m[1], `v${m[2]}`]);
  }
  return out;
}

// --- Rust ---------------------------------------------------------------

function cargoVersion(value) {
  if (typeof value === 'string') return value;
  if (!isPlainObject(value)) return 'latest';
  if ('path' in value) return `path:${value.path}${value.version ? `:${value.version}` : ''}`;
  if ('git' in value) return `git:${value.git}#${value.branch || value.rev || 'latest'}`;
  return value.version || 'latest';
}

function parseCargoToml(content) {
  let doc;
  try {
    doc = TOML.parse(content);
  } catch {
    return [];
  }
  // `[workspace.dependencies]` parses to doc.workspace.dependencies. The
  // original looked up the literal key 'workspace.dependencies', which TOML
  // never produces, so a workspace's shared dependencies were never read.
  const workspace = isPlainObject(doc.workspace) ? doc.workspace.dependencies : undefined;
  const deps = {
    ...(isPlainObject(doc.dependencies) ? doc.dependencies : {}),
    ...(isPlainObject(doc['dev-dependencies']) ? doc['dev-dependencies'] : {}),
    ...(isPlainObject(doc['build-dependencies']) ? doc['build-dependencies'] : {}),
    ...(isPlainObject(workspace) ? workspace : {}),
  };
  return Object.entries(deps).map(([name, value]) => ['rust', name, cargoVersion(value)]);
}

// --- Ruby ---------------------------------------------------------------

// `gem "name"`, `gem 'name'`, optionally followed by a quoted version.
const GEM_RE = /^\s*gem\s+(["'])([^"']+)\1(?:\s*,\s*(["'])([^"']+)\3)?/;

function parseGemfile(content) {
  const deps = new Map();
  for (const line of content.split(/\r?\n/)) {
    const m = GEM_RE.exec(line);
    if (!m) continue;
    deps.set(m[2], m[4] || 'latest');
  }
  return [...deps].map(([name, version]) => ['ruby', name, version]);
}

// --- PHP ----------------------------------------------------------------

// A composer.json with no `name` is skipped, as it was: that is how the
// original told a package manifest from other JSON that happens to share
// the filename.
function parseComposerJson(content) {
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isPlainObject(doc) || !doc.name) return [];
  const deps = {
    ...(isPlainObject(doc.require) ? doc.require : {}),
    ...(isPlainObject(doc['require-dev']) ? doc['require-dev'] : {}),
  };
  return Object.entries(deps).map(([name, version]) => ['php', name, String(version)]);
}

// --- Deno ---------------------------------------------------------------

function parseDenoLock(content) {
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isPlainObject(doc) || !doc.version || !isPlainObject(doc.remote)) return [];
  return Object.entries(doc.remote).map(([name, hash]) => ['deno', name, String(hash)]);
}

// --- Terraform ----------------------------------------------------------

// Strip `#` and `//` line comments and `/* */` block comments, outside
// string literals. Enough HCL to find block headers without being fooled
// by a commented-out one; not a general HCL parser.
function stripHclComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && next === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PROVIDER_BLOCK_RE = /provider\s+"([^"]+)"\s*\{([^}]*)\}/g;
const VERSION_RE = /\bversion\s*=\s*"([^"]*)"/;

function parseTerraformLock(content) {
  const text = stripHclComments(content);
  const seen = new Map();
  for (const m of text.matchAll(PROVIDER_BLOCK_RE)) {
    const version = VERSION_RE.exec(m[2]);
    if (!seen.has(m[1])) seen.set(m[1], version ? version[1] : 'latest');
  }
  return [...seen].map(([name, version]) => ['terraform', name, version || 'latest']);
}

const RESOURCE_RE = /^\s*resource\s+"([^"]+)"\s+"[^"]*"/gm;

function parseTerraformResources(content) {
  const text = stripHclComments(content);
  const types = new Set();
  for (const m of text.matchAll(RESOURCE_RE)) {
    if (isKnownResourceType(m[1])) types.add(m[1]);
  }
  return [...types].map(type => ['terraform.resource', type, 'unknown']);
}

// --- GitHub Actions -----------------------------------------------------

function imageOf(value) {
  if (typeof value === 'string') return value;
  if (isPlainObject(value) && typeof value.image === 'string') return value.image;
  return null;
}

function parseWorkflowDependencies(content) {
  const doc = parseYamlSafe(content);
  if (!isPlainObject(doc) || !isPlainObject(doc.jobs)) return [];
  const out = [];
  for (const job of Object.values(doc.jobs)) {
    if (!isPlainObject(job)) continue;
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (!isPlainObject(step) || typeof step.uses !== 'string') continue;
      const at = step.uses.indexOf('@');
      const name = at === -1 ? step.uses : step.uses.slice(0, at);
      const version = at === -1 ? '' : step.uses.slice(at + 1);
      out.push(['githubAction', name, version || 'latest']);
    }
    const container = imageOf(job.container);
    if (container) {
      const [name, version] = splitImage(container);
      out.push(['docker', name, version || 'latest']);
    }
    for (const service of isPlainObject(job.services) ? Object.values(job.services) : []) {
      const image = imageOf(service);
      if (!image) continue;
      const [name, version] = splitImage(image);
      out.push(['docker', name, version || 'latest']);
    }
  }
  return out;
}

// --- dispatch -----------------------------------------------------------

// [test on the repository-relative path, parser, optional byte limit].
const MANIFESTS = [
  [p => path.basename(p) === 'go.mod', parseGoMod],
  [p => path.basename(p) === 'Cargo.toml', parseCargoToml],
  [p => path.basename(p) === 'Gemfile', parseGemfile],
  [p => path.basename(p) === 'composer.json', parseComposerJson],
  [p => path.basename(p) === 'deno.lock', parseDenoLock],
  [p => path.basename(p) === '.terraform.lock.hcl', parseTerraformLock],
  [p => TF_RE.test(p), parseTerraformResources, MAX_TF_BYTES],
  [p => WORKFLOW_RE.test(p), parseWorkflowDependencies],
];

function parserFor(relPath) {
  return MANIFESTS.find(([test]) => test(relPath)) || null;
}

/**
 * Every dependency tuple the manifests in `absolutePaths` declare.
 *
 * Returns [{ path, type, name, version }], `path` repository-relative.
 * Files are opened through the provider, so its size limits, symlink
 * refusal and relevance policy apply exactly as they do to every other
 * parser; a file it refuses to open contributes nothing.
 */
async function readDependencyManifests(provider, absolutePaths) {
  const out = [];
  for (const absPath of absolutePaths) {
    const relPath = provider.relPath(absPath);
    const entry = parserFor(relPath);
    if (!entry) continue;
    const [, parse, maxBytes] = entry;
    const content = await provider.open(absPath);
    if (content == null) continue;
    if (maxBytes && Buffer.byteLength(content) > maxBytes) continue;
    for (const [type, name, version] of parse(content)) {
      out.push({ path: relPath, type, name, version });
    }
  }
  return out;
}

module.exports = {
  readDependencyManifests,
  parseGoMod,
  parseCargoToml,
  parseGemfile,
  parseComposerJson,
  parseDenoLock,
  parseTerraformLock,
  parseTerraformResources,
  parseWorkflowDependencies,
  stripHclComments,
  splitImage,
};
