// SDK import parser: scans JS/TS and Python source text for
// import/require statements, matches the imported module against the
// icon crosswalk, and emits `sdk-import` evidence for the ones that hit.
// This is regex-based, never a real parse and never an eval -- the
// repository's code is data, and this module never executes any of it.

const { lookup } = require('../crosswalk');

// JS/TS: `import x from 'pkg'`, `import 'pkg'`, `import x, {y} from "pkg"`,
// `export ... from 'pkg'`, and `require('pkg')`. Captures the raw module
// specifier; scoped packages ("@scope/name") and subpaths
// ("@scope/name/sub") are both matched, crosswalk.normalise() takes the
// last path segment as the lookup key which is intentional (matches how
// docker image names are normalised too).
//
// The gap between "import"/"export" and "from" is bounded to 500
// characters ({0,500}?, not the unbounded *?  an earlier version of this
// file used). Unbounded, that lazy scan is run once per "import"/"export"
// occurrence (the 'g' flag retries from the next position after a failed
// match), so a file with no real "from" anywhere -- e.g. a 1MB line of
// nothing but the word "import " repeated -- makes the engine re-scan an
// ever-shrinking tail of the remaining string at every single occurrence:
// O(n) work times O(n) occurrences. Measured on exactly that input, the
// unbounded version took over 100 seconds; capped at 500 it is
// effectively O(n). 500 characters is generous for any real import
// statement (this class already excludes newlines, so it can only ever
// match within one line regardless).
const JS_IMPORT_RE =
  /\b(?:import|export)\b[^'"()\n]{0,500}?from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// Python: `import pkg`, `import pkg.sub`, `from pkg import x`,
// `from pkg.sub import x`. Only the top-level module name is used. The
// `import ...` capture is deliberately restricted to a single line
// ([^\n]+ rather than [\s\S]+/plain \s+) -- a plain \s class matches
// newlines too, which would let one "import x" statement's capture
// group swallow every subsequent line as fake extra imports.
const PY_IMPORT_RE = /^[ \t]*(?:from\s+([A-Za-z0-9_.]+)\s+import\b|import\s+([^\n]+))/gm;

function moduleRoot(specifier) {
  if (specifier.startsWith('.')) return null; // relative import: not an SDK
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/'); // @scope/name
  }
  return specifier.split('/')[0];
}

function findLineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function parseJsImports(path, content) {
  const records = [];
  const seen = new Set();
  let m;
  JS_IMPORT_RE.lastIndex = 0;
  while ((m = JS_IMPORT_RE.exec(content))) {
    const specifier = m[1] || m[2] || m[3];
    if (!specifier) continue;
    const root = moduleRoot(specifier);
    if (!root) continue;
    const cross = lookup(root);
    if (!cross) continue;
    const line = findLineOf(content, m.index);
    const dedupeKey = `${line}:${root}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    records.push({ kind: 'sdk-import', path, line, value: root, tech: cross.tech, icon: cross.icon });
  }
  return records;
}

function parsePyImports(path, content) {
  const records = [];
  const seen = new Set();
  let m;
  PY_IMPORT_RE.lastIndex = 0;
  while ((m = PY_IMPORT_RE.exec(content))) {
    const modules = [];
    if (m[1]) modules.push(m[1]);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) modules.push(name);
      }
    }
    for (const mod of modules) {
      const root = mod.split('.')[0];
      const cross = lookup(root);
      if (!cross) continue;
      const line = findLineOf(content, m.index);
      const dedupeKey = `${line}:${root}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      records.push({ kind: 'sdk-import', path, line, value: root, tech: cross.tech, icon: cross.icon });
    }
  }
  return records;
}

const JS_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const PY_EXT_RE = /\.py$/i;

// Dispatches to the right parser by extension. Returns [] for anything
// else (this module only understands JS/TS and Python source).
function parseImports(path, content) {
  if (JS_EXT_RE.test(path)) return parseJsImports(path, content);
  if (PY_EXT_RE.test(path)) return parsePyImports(path, content);
  return [];
}

module.exports = { parseImports, parseJsImports, parsePyImports, moduleRoot };
