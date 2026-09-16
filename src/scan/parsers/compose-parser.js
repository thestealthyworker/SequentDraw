// docker-compose*.yml parser: stack-analyser detects individual images as
// technologies, but does not give us service names, depends_on edges, or
// links -- exactly the "own small parsers where stack-analyser does not
// give edges" the design doc calls for.
//
// Emits raw evidence-shaped records (without ids; evidence.js assigns
// those once every source has run). One record per (path, line, kind,
// value) tuple:
//   compose-service  { path, line, value: serviceName }
//   image            { path, line, value: imageName, tech?, icon? }
//   depends-on       { path, line, from: serviceName, to: serviceName,
//                      role: 'deployment' }
//     (also emitted for `links:`, same shape)
//   build-context    { path, line, from: serviceName, to: directory }
//
// `role: 'deployment'` is not decoration (CTO-M1-02). `depends_on` states
// a STARTUP order -- "start after" -- and says nothing about which way
// work flows; the two coincide only when a service happens to write to
// its dependency. Tagging the fact at the point it is read is what lets
// the skill draw these as deployment dependencies rather than as work
// arrows, and what stopped the voting app rendering back to front.
//
// `build-context` records which directory a service is built from. That
// is the repository stating, in its own compose file, that a directory is
// part of the product -- used to attribute source files to services (so a
// data-access fact in `worker/Program.cs` belongs to the `worker`
// service) and to keep such a directory out of the relevance policy's
// exclusions.

const { parseYamlSafe } = require('../yaml-safe');
const { lookup } = require('../crosswalk');
const { normalise: normalisePath } = require('../exclusions');

// Finds the 1-based line number of the first occurrence of `needle` at
// the start of a YAML mapping key (best-effort; used only for the
// evidence "line" field, which is informational, not load-bearing).
function findLine(lines, re, fromLine = 0) {
  for (let i = fromLine; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.keys(value);
  return [];
}

function parseCompose(path, content) {
  const doc = parseYamlSafe(content);
  const records = [];
  if (!doc || typeof doc !== 'object' || typeof doc.services !== 'object' || doc.services == null) {
    return records;
  }

  const lines = content.split(/\r\n|\r|\n/);
  const serviceNames = Object.keys(doc.services);

  for (const serviceName of serviceNames) {
    const service = doc.services[serviceName];
    if (!service || typeof service !== 'object') continue;

    const serviceLineRe = new RegExp(`^\\s{0,4}${escapeRegExp(serviceName)}\\s*:\\s*$`);
    const serviceLine = findLine(lines, serviceLineRe) || null;

    records.push({ kind: 'compose-service', path, line: serviceLine, value: serviceName });

    if (typeof service.image === 'string' && service.image.trim().length > 0) {
      const image = service.image.trim();
      const imageLine = findLine(lines, /^\s*image\s*:/, serviceLine ? serviceLine - 1 : 0) || serviceLine;
      const cross = lookup(image);
      // Split "postgres:16" into name "postgres" / version "16", matching
      // how stack-analyser's own docker-dependency tuples represent an
      // image -- this is what lets evidence.js dedupe the two sources
      // against the same (path, kind, value) key rather than emitting
      // "postgres:16" and "postgres" as two separate facts.
      const [imageName, imageTag] = image.split(':');
      records.push({
        kind: 'image',
        path,
        line: imageLine,
        value: imageName,
        version: imageTag || null,
        tech: cross ? cross.tech : null,
        icon: cross ? cross.icon : null,
      });
    }

    const buildContext = readBuildContext(service);
    if (buildContext) {
      const buildLine = findLine(lines, /^\s*build\s*:/, serviceLine ? serviceLine - 1 : 0) || serviceLine;
      records.push({ kind: 'build-context', path, line: buildLine, from: serviceName, to: buildContext });
    }

    const dependsOn = asArray(service.depends_on);
    for (const dep of dependsOn) {
      if (typeof dep !== 'string') continue;
      const dependsLine = findLine(lines, /^\s*depends_on\s*:/, serviceLine ? serviceLine - 1 : 0) || serviceLine;
      records.push({ kind: 'depends-on', path, line: dependsLine, from: serviceName, to: dep, role: 'deployment' });
    }

    const links = asArray(service.links);
    for (const link of links) {
      if (typeof link !== 'string') continue;
      // "service:alias" or "service" -- the target is the part before ':'.
      const target = link.split(':')[0].trim();
      if (!target) continue;
      const linksLine = findLine(lines, /^\s*links\s*:/, serviceLine ? serviceLine - 1 : 0) || serviceLine;
      records.push({ kind: 'depends-on', path, line: linksLine, from: serviceName, to: target, role: 'deployment' });
    }
  }

  return records;
}

// `build: ./vote` or `build: { context: ./vote }`. Returns the context
// directory relative to the repo root, or null.
function readBuildContext(service) {
  const build = service.build;
  if (typeof build === 'string') return normalisePath(build) || null;
  if (build && typeof build === 'object' && typeof build.context === 'string') {
    return normalisePath(build.context) || null;
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parseCompose };
