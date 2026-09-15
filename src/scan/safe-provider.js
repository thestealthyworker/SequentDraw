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

const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_DEPTH = 25;
const DEFAULT_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1MB
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB
const BINARY_SNIFF_BYTES = 8192;
const MAX_LINE_LENGTH = 5000;

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

// Real secret-bearing env files: ".env" itself, or ".env.<anything>"
// except the three safe example/template names, which are handled
// separately (read, values stripped, then treated as ordinary text).
const SAFE_ENV_NAMES = new Set(['.env.example', '.env.sample', '.env.template']);

function classifyEnvFile(basename) {
  if (basename === '.env') return 'real';
  if (!basename.startsWith('.env.')) return null;
  return SAFE_ENV_NAMES.has(basename) ? 'safe-example' : 'real';
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

// Strips the value out of every "NAME=value" line, keeping the name only,
// so a rule (or a human) can see which variables are declared without
// ever seeing what a real deployment sets them to. Handles a leading
// `export `, single/double-quoted values, and a trailing inline `#`
// comment. This is intentionally conservative about what it treats as a
// "value" -- anything after the first `=` up to end of line/comment is
// discarded, no exceptions.
function stripEnvValues(content) {
  return content
    .split(/\r\n|\r|\n/)
    .map(line => {
      const trimmed = line.replace(/^﻿/, '');
      const m = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/.exec(trimmed);
      if (!m) return line;
      const [, indent, exportKw, name] = m;
      return `${indent}${exportKw || ''}${name}=`;
    })
    .join('\n');
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
    this.findings = []; // { kind: 'real-env-file', path }
    this._realEnvSeen = new Set();
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
