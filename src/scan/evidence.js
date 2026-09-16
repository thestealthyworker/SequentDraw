// Turns raw, source-tagged records (from the custom parsers and from
// mapping @specfy/stack-analyser's payload tree) into the bundle's final
// `evidence` array: deterministic ids, a stable sort order, and hard
// truncation of every string field, so the bundle is safe to serialise
// and safe to diff between two runs of the same scan.

const { stripControlChars } = require('./sanitize-text');
const { lookup } = require('./crosswalk');

const MAX_STRING_LENGTH = 200;
const EVIDENCE_STRING_FIELDS = ['path', 'value', 'from', 'to', 'tech', 'icon'];

function truncateString(value) {
  if (typeof value !== 'string') return value;
  const clean = stripControlChars(value);
  return clean.length > MAX_STRING_LENGTH ? clean.slice(0, MAX_STRING_LENGTH) : clean;
}

function normalisePath(p) {
  if (typeof p !== 'string') return '';
  let out = p.split('\\').join('/');
  out = out.replace(/^\.\//, '');
  while (out.startsWith('/')) out = out.slice(1);
  return out;
}

// stack-analyser dependency types (see node_modules/@specfy/stack-analyser
// /dist/loader.js `dependencies` map) that get mapped into evidence, and
// which evidence kind each maps to. Anything not listed here (php, ruby,
// rust, golang, deno) is treated generically as 'manifest-dependency'.
const DEP_TYPE_KIND = {
  'terraform.resource': 'iac-resource',
  docker: 'image',
  githubAction: 'ci-job',
};

// Dependency types SequentDraw's own manifest-parser.js already covers in
// full, with real per-entry line numbers (package.json -> npm,
// requirements.txt -> python). stack-analyser's own dependency tuples for
// these carry no line number and, for a multi-file ecosystem, sometimes
// attribute the whole set to a folder-level path rather than the exact
// manifest -- so these types are skipped here entirely rather than
// half-deduped by (path, value), which would miss real duplicates
// whenever the paths do not happen to match exactly.
const DEP_TYPES_COVERED_BY_OWN_PARSERS = new Set(['npm', 'python']);

// Recursively walks a stack-analyser AnalyserJson tree (payload.toJson())
// and yields one raw record per dependency tuple [type, name, version].
// Only dependencies are harvested here -- technology/component detection
// on its own (payload.tech, payload.techs) is not citable evidence by
// itself (design doc: "a manifest entry alone is weak evidence"), it is
// the *dependency* fact that is.
function mapStackAnalyserDependencies(node, records = []) {
  if (!node || typeof node !== 'object') return records;

  const paths = Array.isArray(node.path) ? node.path : [];
  const primaryPath = normalisePath(paths[0] || '');

  for (const dep of node.dependencies || []) {
    if (!Array.isArray(dep) || dep.length < 2) continue;
    const [depType, name, version] = dep;
    if (DEP_TYPES_COVERED_BY_OWN_PARSERS.has(depType)) continue;
    const kind = DEP_TYPE_KIND[depType] || 'manifest-dependency';
    const cross = lookup(name);
    records.push({
      kind,
      path: primaryPath,
      line: null,
      value: name,
      version: typeof version === 'string' ? version : null,
      tech: cross ? cross.tech : null,
      icon: cross ? cross.icon : null,
      __source: 'stack-analyser',
    });
  }

  for (const child of node.childs || []) {
    mapStackAnalyserDependencies(child, records);
  }

  return records;
}

// Drops a stack-analyser-derived manifest-dependency record when a custom
// parser already produced a record for the same (path, kind, value):
// ours carries a real line number, stack-analyser's does not, so ours
// wins. This is what lets stack-analyser cover the ~15 ecosystems we did
// not write a bespoke parser for (go.mod, Cargo.toml, composer.json, ...)
// without duplicating evidence for package.json/requirements.txt, which
// we do parse ourselves.
function dedupeAgainstOwnParsers(records) {
  const ownKeys = new Set(
    records.filter(r => r.__source !== 'stack-analyser').map(r => `${r.kind}\u0000${r.path}\u0000${r.value}`),
  );
  return records.filter(r => {
    if (r.__source !== 'stack-analyser') return true;
    const key = `${r.kind}\u0000${r.path}\u0000${r.value}`;
    return !ownKeys.has(key);
  });
}

function sortKey(record) {
  const path = record.path || '';
  const line = record.line == null ? Number.MAX_SAFE_INTEGER : record.line;
  const kind = record.kind || '';
  const value = record.value || record.from || '';
  return [path, line, kind, value];
}

function compareRecords(a, b) {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// Assigns final, stable-order ids ("ev1", "ev2", ...) and strips internal
// bookkeeping fields (__source) and undefined-valued fields, so the
// bundle's evidence array matches the shape from the design doc exactly.
function assembleEvidence(rawRecords) {
  const deduped = dedupeAgainstOwnParsers(rawRecords);
  const sorted = [...deduped].sort(compareRecords);

  return sorted.map((record, index) => {
    const entry = { id: `ev${index + 1}`, kind: record.kind };
    entry.path = normalisePath(record.path);
    if (record.line != null) entry.line = record.line;
    // `direction` ('read'|'write') and `role` ('deployment') are what
    // carry CTO-M1-02's distinction between a work-flow arrow and a
    // startup dependency into the bundle, so they must survive assembly.
    for (const field of ['value', 'from', 'to', 'tech', 'icon', 'version', 'direction', 'role']) {
      const value = record[field];
      if (value == null) continue;
      entry[field] = EVIDENCE_STRING_FIELDS.includes(field) ? truncateString(value) : value;
    }
    return entry;
  });
}

module.exports = {
  assembleEvidence,
  mapStackAnalyserDependencies,
  dedupeAgainstOwnParsers,
  normalisePath,
  truncateString,
  MAX_STRING_LENGTH,
};
