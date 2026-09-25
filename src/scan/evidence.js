// Turns raw, source-tagged records (from the bespoke parsers and from the
// vendored dependency-manifest parsers in rules/) into the bundle's final
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

// Dependency types, as src/scan/rules/dependency-manifests.js reports them,
// that map to a specific evidence kind. Anything not listed (golang, rust,
// ruby, php, deno, terraform providers) is a 'manifest-dependency'.
const DEP_TYPE_KIND = {
  'terraform.resource': 'iac-resource',
  docker: 'image',
  githubAction: 'ci-job',
};

// The source tag on records that come from the vendored dependency-manifest
// parsers, so dedupeAgainstOwnParsers can let a bespoke parser's record --
// which carries a line number -- win over one of these, which does not.
const MANIFEST_SOURCE = 'dependency-manifests';

// One raw evidence record per dependency tuple. Each carries the path of
// the manifest it was read from; the original stack-analyser tree lost the
// path of every "virtual" manifest, which is fixed at the source now.
function mapDependencyTuples(tuples) {
  return tuples.map(({ path: filePath, type, name, version }) => {
    const cross = lookup(name);
    return {
      kind: DEP_TYPE_KIND[type] || 'manifest-dependency',
      path: normalisePath(filePath),
      line: null,
      value: name,
      version: typeof version === 'string' ? version : null,
      tech: cross ? cross.tech : null,
      icon: cross ? cross.icon : null,
      __source: MANIFEST_SOURCE,
    };
  });
}

// Drops a dependency-manifest record when a bespoke parser already produced
// a record for the same (path, kind, value): the bespoke one carries a real
// line number, so it wins.
function dedupeAgainstOwnParsers(records) {
  const ownKeys = new Set(
    records.filter(r => r.__source !== MANIFEST_SOURCE).map(r => `${r.kind}\u0000${r.path}\u0000${r.value}`),
  );
  return records.filter(r => {
    if (r.__source !== MANIFEST_SOURCE) return true;
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
  mapDependencyTuples,
  dedupeAgainstOwnParsers,
  normalisePath,
  truncateString,
  MAX_STRING_LENGTH,
};
