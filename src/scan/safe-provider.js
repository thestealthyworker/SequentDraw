// SafeProvider: SequentDraw's implementation of the three-method provider
// interface @specfy/stack-analyser expects (see node_modules/@specfy/
// stack-analyser/dist/provider/fs.js and dist/provider/base.d.ts):
//
//   basePath: string
//   listDir(path): Promise<{ name, type: 'dir'|'file', fp }[]>
//   stat(path): Promise<{ size: number } | null>
//   open(path): Promise<string | null>
//
// stack-analyser's own FSProvider has no limits and follows symlinks
// implicitly (plain fs.readdir/fs.stat). This provider is the one and
// only filesystem gateway the analyser is given: every guard below (size
// caps, symlink confinement, secret redaction, control-character
// stripping) applies regardless of what stack-analyser -- or any custom
// parser reusing this provider -- asks for.
//
// The `path` arguments stack-analyser passes are not relative: `analyser()`
// calls `pl.recurse(provider, provider.basePath)`, and recurse builds
// every subsequent path with `path.join(currentPath, entry.name)`
// starting from that absolute basePath (see fs.js). So every path this
// provider receives is expected to already be an absolute path under
// basePath; `_confine()` re-derives and re-checks that regardless of what
// is passed, so a hostile or buggy caller passing '../../etc/passwd' (or
// anything else that would resolve outside basePath) is refused rather
// than trusted.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { stripControlChars } = require('./sanitize-text');
const { parseYamlSafe, checkYamlLimits } = require('./yaml-safe');

const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_DEPTH = 25;
const DEFAULT_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1MB
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB
const BINARY_SNIFF_BYTES = 8192;
const MAX_LINE_LENGTH = 5000;

// A YAML file gets a tighter per-file cap than the generic
// maxFileBytes: 256KB, checked against the file's stat size BEFORE it
// is ever read into memory (see item 1(a) of the fix-round-2 security
// re-check -- a flat, very-wide YAML document can make the underlying
// parser's own bookkeeping grow super-quadratically, so this content
// must never even reach that parser in the first place if it is
// implausibly large for the compose/workflow files this engine
// actually needs to read).
const YAML_MAX_FILE_BYTES = 256 * 1024;

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.git',
  '.next',
  'target',
  'coverage',
  '.venv',
  '__pycache__',
]);

const MINIFIED_SUFFIXES = ['.min.js', '.min.css'];
const YAML_EXT_RE = /\.ya?ml$/i;

// Real secret-bearing env files: ".env" itself, or ".env.<anything>"
// except the three safe example/template names, which are handled
// separately (read, values stripped, then treated as ordinary text).
const SAFE_ENV_NAMES = new Set(['.env.example', '.env.sample', '.env.template']);

// Compares a trimmed, lowercased name, so ".ENV", ".Env.Local" and
// ".env " (trailing whitespace) are all still recognised as real env
// files -- and never fall through unrecognised (and therefore openable)
// just because of how a filesystem or archive happened to case- or
// whitespace-mangle the name.
function classifyEnvFile(basename) {
  const normalised = typeof basename === 'string' ? basename.trim().toLowerCase() : '';
  if (normalised === '.env') return 'real';
  if (!normalised.startsWith('.env.')) return null;
  return SAFE_ENV_NAMES.has(normalised) ? 'safe-example' : 'real';
}

function isMinifiedByName(basename) {
  const lower = basename.toLowerCase();
  return MINIFIED_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

function hasOverlongLine(text) {
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      if (i - start > MAX_LINE_LENGTH) return true;
      start = i + 1;
    }
  }
  return false;
}

// Matches the start of a "NAME=" (or "# NAME=", a commented-out
// declaration -- a real secret pasted into a comment by mistake is just
// as much a leak as one in a live line) declaration, with an optional
// leading `export`. Anchored to a real line start ('m' flag + '^') so it
// is never fooled by an "=" appearing inside a preceding value.
const DECLARATION_RE = /^([ \t]*)(#[ \t]*)?(export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm;

// Finds the index of the next unescaped occurrence of `quoteChar` at or
// after `startIndex` (an escaped quote, "\\\"", does not close the
// value). Iterative, single pass; returns content.length (i.e. "runs to
// the end of the string") if the quote is never closed, so an
// unterminated quoted value still gets fully redacted rather than
// leaking whatever follows it.
function findUnescapedQuoteEnd(content, startIndex, quoteChar) {
  let i = startIndex;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quoteChar) return i;
    i++;
  }
  return content.length;
}

// Matches a shell-style heredoc value marker immediately after "=":
// "<<EOF", "<<-EOF" (the "-" form allows leading tabs before the closing
// delimiter in real shells; not load-bearing here since only the
// delimiter text itself is used), "<<'EOF'", "<<\"EOF\"". Group 2/3/4
// hold the delimiter, whichever quoting form matched.
const HEREDOC_START_RE = /^<<(-)?\s*(?:"([^"\n]*)"|'([^'\n]*)'|([A-Za-z0-9_]+))/;

// Finds where a heredoc value ends: the index right after the first
// subsequent line whose content, trimmed, exactly equals `delimiter`
// (real shell heredoc semantics -- the delimiter must appear alone on
// its own line). `searchFrom` is the index right after the marker
// line's own newline. Returns content.length (redact to end of file) if
// the delimiter is never found, matching findUnescapedQuoteEnd's
// "unterminated -> redact everything" posture.
function findHeredocEnd(content, searchFrom, delimiter) {
  let cursor = searchFrom;
  while (cursor <= content.length) {
    const nl = content.indexOf('\n', cursor);
    const lineEnd = nl === -1 ? content.length : nl;
    if (content.slice(cursor, lineEnd).trim() === delimiter) {
      return nl === -1 ? content.length : nl + 1;
    }
    if (nl === -1) break;
    cursor = nl + 1;
  }
  return content.length;
}

// Everything between (and after) declarations that is NOT itself a
// blank line or a full-line comment is dropped rather than passed
// through unchanged. This is a second, independent line of defence
// against a heredoc body (or anything else shaped in a way this parser
// does not specifically recognise) ever surviving into the returned
// content, on top of the explicit heredoc handling in stripEnvValues()
// below -- so even a form neither of them was written for degrades to
// "silently removed", never "leaked verbatim".
function filterNonDeclarationLines(segment) {
  if (segment.length === 0) return '';
  return segment
    .split('\n')
    .filter(line => line.trim() === '' || line.trimStart().startsWith('#'))
    .join('\n');
}

// Strips the value out of every "NAME=value" declaration (and a
// commented-out "# NAME=value"), keeping the name only, so a rule (or a
// human) can see which variables are declared without ever seeing what a
// real deployment sets them to. Handles a leading `export`, an inline
// trailing `#` comment (discarded along with the value), a
// double/single-quoted value that spans MULTIPLE lines (some .env
// parsers, e.g. the `dotenv` npm package, support this), and a
// shell-style heredoc value ("NAME=<<EOF" ... "EOF") -- each of these
// spans, embedded newlines included, is treated as one value and fully
// redacted, never scanned line-by-line (which would otherwise let a
// continuation line's content leak through unstripped). Everything
// between and after declarations that is not itself blank or a
// full-line comment is ALSO dropped (filterNonDeclarationLines), as a
// second, independent line of defence for any value-bearing shape
// neither of the above was specifically written for. CRLF and lone CR
// line endings are normalised to LF first; downstream stripControlChars
// removes any literal CR anyway, so no information is lost by doing so
// here. This is intentionally conservative about what counts as a
// "value" -- everything between the "=" and the end of that value
// (whichever form it takes) is discarded, no exceptions.
function stripEnvValues(content) {
  const normalised = content.replace(/\r\n|\r/g, '\n');
  let result = '';
  let cursor = 0;

  DECLARATION_RE.lastIndex = 0;
  let m;
  while ((m = DECLARATION_RE.exec(normalised))) {
    const matchStart = m.index;
    const matchEnd = DECLARATION_RE.lastIndex; // index right after "="
    const [, indent, hashPrefix, exportKw, name] = m;

    result += filterNonDeclarationLines(normalised.slice(cursor, matchStart));

    let valueEnd;
    const firstValueChar = normalised[matchEnd];
    if (firstValueChar === '"' || firstValueChar === "'") {
      const closeIdx = findUnescapedQuoteEnd(normalised, matchEnd + 1, firstValueChar);
      valueEnd = closeIdx < normalised.length ? closeIdx + 1 : normalised.length;
    } else {
      const heredoc = HEREDOC_START_RE.exec(normalised.slice(matchEnd));
      if (heredoc) {
        const delimiter = heredoc[2] ?? heredoc[3] ?? heredoc[4];
        const markerLineEnd = normalised.indexOf('\n', matchEnd);
        valueEnd = markerLineEnd === -1 ? normalised.length : findHeredocEnd(normalised, markerLineEnd + 1, delimiter);
      } else {
        const nlIdx = normalised.indexOf('\n', matchEnd);
        valueEnd = nlIdx === -1 ? normalised.length : nlIdx;
      }
    }

    result += `${indent}${hashPrefix || ''}${exportKw || ''}${name}=`;
    cursor = valueEnd;
    // Resume scanning after the whole consumed value -- so nothing
    // inside a multi-line quoted value or a heredoc body (however
    // "NAME="-shaped it might look) is ever treated as a second,
    // independent declaration.
    DECLARATION_RE.lastIndex = valueEnd;
  }

  result += filterNonDeclarationLines(normalised.slice(cursor));
  return result;
}

class SafeProvider {
  constructor(opts = {}) {
    const basePath = opts.path;
    if (typeof basePath !== 'string' || basePath.length === 0) {
      throw new TypeError('SafeProvider requires opts.path (the repo root)');
    }
    this.basePath = path.resolve(basePath);
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

    this.filesListed = 0;
    this.bytesOpened = 0;
    this._totalBytesExceeded = false;
    this._reasons = [];
    this.findings = []; // { kind: 'real-env-file', path } | { kind: 'yaml-rejected', path, reason }
    this._realEnvSeen = new Set();
    this._yamlRejectedSeen = new Set();
  }

  get truncated() {
    return this._reasons.length > 0;
  }

  get reason() {
    return this._reasons.length > 0 ? this._reasons.join('; ') : null;
  }

  _markTruncated(reason) {
    if (!this._reasons.includes(reason)) this._reasons.push(reason);
  }

  relPath(absPath) {
    const rel = path.relative(this.basePath, absPath);
    return rel === '' ? '.' : rel.split(path.sep).join('/');
  }

  // Resolves and confines an arbitrary path argument to basePath. Returns
  // null (never throws) for anything that would resolve outside it --
  // '..' segments, an absolute path elsewhere, or a symlink target that
  // would otherwise escape. Callers must treat null as "does not exist".
  _confine(pathArg) {
    if (typeof pathArg !== 'string' || pathArg.length === 0) return null;
    const resolved = path.isAbsolute(pathArg) ? path.resolve(pathArg) : path.resolve(this.basePath, pathArg);
    if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
      return null;
    }
    return resolved;
  }

  _depthOf(absPath) {
    const rel = path.relative(this.basePath, absPath);
    if (rel === '' || rel === '.') return 0;
    return rel.split(path.sep).length;
  }

  _recordRealEnvFile(absPath) {
    const rel = this.relPath(absPath);
    if (this._realEnvSeen.has(rel)) return;
    this._realEnvSeen.add(rel);
    this.findings.push({ kind: 'real-env-file', path: rel });
  }

  _recordYamlRejected(absPath, reason) {
    const rel = this.relPath(absPath);
    const key = `${rel} ${reason}`;
    if (this._yamlRejectedSeen.has(key)) return;
    this._yamlRejectedSeen.add(key);
    this.findings.push({ kind: 'yaml-rejected', path: rel, reason });
  }

  async listDir(pathArg) {
    const dirPath = this._confine(pathArg);
    if (!dirPath) return [];

    const depth = this._depthOf(dirPath);
    if (depth >= this.maxDepth) {
      this._markTruncated(`directory depth exceeded ${this.maxDepth} levels at "${this.relPath(dirPath)}"`);
      return [];
    }

    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const results = [];
    for (const entry of entries) {
      if (this.filesListed >= this.maxFiles) {
        this._markTruncated(`file listing exceeded ${this.maxFiles} files`);
        break;
      }

      const fullPath = path.join(dirPath, entry.name);

      // Confinement + symlink check via lstat: never follow a symlink,
      // in either direction (a symlinked dir is never descended into, a
      // symlinked file is never read). Treat a symlink as if it were
      // absent rather than erroring, so a symlink loop or a link to
      // /etc simply does not appear in the tree.
      let lst;
      try {
        lst = await fsp.lstat(fullPath);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) continue;

      const isDir = lst.isDirectory();
      if (isDir) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
      } else {
        if (!lst.isFile()) continue; // device files, sockets, fifos: ignore
        if (isMinifiedByName(entry.name)) continue;
      }

      this.filesListed++;
      results.push({ name: entry.name, type: isDir ? 'dir' : 'file', fp: fullPath });
    }
    return results;
  }

  async stat(pathArg) {
    const p = this._confine(pathArg);
    if (!p) return null;
    let lst;
    try {
      lst = await fsp.lstat(p);
    } catch {
      return null;
    }
    if (lst.isSymbolicLink()) return null;
    return { size: lst.size };
  }

  async open(pathArg) {
    const p = this._confine(pathArg);
    if (!p) return null;

    let lst;
    try {
      lst = await fsp.lstat(p);
    } catch {
      return null;
    }
    if (lst.isSymbolicLink() || !lst.isFile()) return null;

    const base = path.basename(p);
    const isYaml = YAML_EXT_RE.test(base);
    const envKind = classifyEnvFile(base);
    if (envKind === 'real') {
      this._recordRealEnvFile(p);
      return null;
    }
    if (isMinifiedByName(base)) return null;

    if (this._totalBytesExceeded) {
      this._markTruncated(`total bytes budget of ${this.maxTotalBytes} exceeded; later files were not opened`);
      return null;
    }

    // A YAML file never even reaches the generic per-file cap: it gets
    // its own tighter one, checked against the file's stat size before
    // any of it is read into memory (see YAML_MAX_FILE_BYTES above).
    if (isYaml && lst.size > YAML_MAX_FILE_BYTES) {
      this._recordYamlRejected(p, 'file-too-large');
      return null;
    }

    if (lst.size > this.maxFileBytes) {
      this._markTruncated(`file exceeds the ${this.maxFileBytes}-byte per-file limit: "${this.relPath(p)}"`);
      return null;
    }

    let buf;
    try {
      buf = await fsp.readFile(p);
    } catch {
      return null;
    }

    // Binary sniff: a NUL byte anywhere in the first 8KB. Applied before
    // the line-length/minified check and before counting toward the
    // total-bytes budget, matching the "skip" (not "limit") treatment
    // binary files get in the design doc.
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;

    const text = buf.toString('utf8');
    if (hasOverlongLine(text)) return null; // minified by content, not just by name

    // Every *.yml/*.yaml file is checked and parsed with the same
    // bounded settings BEFORE its content is ever handed back to a
    // caller -- stack-analyser's own docker and githubActions rules
    // parse repo-supplied YAML too, so this guard has to live here, not
    // only inside src/scan/parsers/*, to cover every path that reaches
    // this content. Two layers, cheapest first: checkYamlLimits() is a
    // linear structural pre-check (lines, apparent entry count, nesting
    // depth) that never does a real parse, so it rejects a pathologically
    // WIDE document (see YAML_MAX_FILE_BYTES's comment) before the real
    // parser ever sees it; parseYamlSafe() is the actual bounded parse,
    // a second independent check. A file that fails either is never
    // returned; only its path and which limit fired are recorded, as a
    // finding, never its (rejected, so possibly hostile) content.
    if (isYaml) {
      const limits = checkYamlLimits(text);
      if (!limits.ok) {
        this._recordYamlRejected(p, limits.reason);
        return null;
      }
      if (parseYamlSafe(text) === null) {
        this._recordYamlRejected(p, 'unparsable');
        return null;
      }
    }

    this.bytesOpened += buf.length;
    if (this.bytesOpened > this.maxTotalBytes) {
      this._totalBytesExceeded = true;
      this._markTruncated(`total bytes opened exceeded ${this.maxTotalBytes}`);
    }

    const sanitisedByValue = envKind === 'safe-example' ? stripEnvValues(text) : text;
    return stripControlChars(sanitisedByValue);
  }
}

module.exports = {
  SafeProvider,
  classifyEnvFile,
  stripEnvValues,
  SKIP_DIR_NAMES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
};
