// Package-manifest dependency parser: package.json (npm) and
// requirements.txt (pip). stack-analyser already reads these for its own
// technology detection, but does not give us a per-dependency line
// number, so we parse them ourselves for `manifest-dependency` evidence
// (design doc: "a manifest entry alone is weak evidence" -- it still
// needs to be citable at a specific path:line).

function findLineForKey(lines, key) {
  const re = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePackageJson(path, content) {
  const records = [];
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    return records;
  }
  if (!doc || typeof doc !== 'object') return records;

  const lines = content.split(/\r\n|\r|\n/);
  const groups = ['dependencies', 'devDependencies'];
  for (const group of groups) {
    const deps = doc[group];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof name !== 'string') continue;
      const line = findLineForKey(lines, name);
      records.push({ kind: 'manifest-dependency', path, line, value: name, version: typeof version === 'string' ? version : null });
    }
  }
  return records;
}

// requirements.txt: one requirement per line, optionally pinned
// ("fastapi==0.110.0"), with an environment marker or extras
// ("celery[redis]>=5.0"), or a comment. We only need the package name.
const REQUIREMENT_RE = /^\s*([A-Za-z0-9_.-]+)\s*(\[[^\]]*\])?\s*([=<>!~]=?[^\s;#]*)?/;

function parseRequirementsTxt(path, content) {
  const records = [];
  const lines = content.split(/\r\n|\r|\n/);
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) return;
    const m = REQUIREMENT_RE.exec(line);
    if (!m || !m[1]) return;
    records.push({ kind: 'manifest-dependency', path, line: idx + 1, value: m[1], version: m[3] || null });
  });
  return records;
}

module.exports = { parsePackageJson, parseRequirementsTxt };
