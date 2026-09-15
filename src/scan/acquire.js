// Acquire step: resolves a scan source (local path or GitHub URL) and,
// for GitHub, clones it into a throwaway temp directory read-only and
// shallow, never running anything the target repository provides.

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ECHO_MAX_LENGTH = 200;

function truncateForError(value) {
  const s = String(value);
  return s.length > ECHO_MAX_LENGTH ? `${s.slice(0, ECHO_MAX_LENGTH)}…` : s;
}

// scp-style ssh syntax ("git@github.com:owner/repo.git") has no "://",
// so it would otherwise fall through to the local-path branch and fail
// with a confusing "does not exist" error. Caught explicitly for a clear
// message instead.
const SCP_LIKE_RE = /^[\w.-]+@[\w.-]+:/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

// GitHub's own charset rules (permissive superset -- we do not need to
// reject every string GitHub itself would reject, only stay inside a
// safe, unambiguous charset before this ever reaches a shell-free
// execFile call).
const OWNER_RE = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO_RE = '[A-Za-z0-9._-]{1,100}';
const GITHUB_PATH_RE = new RegExp(`^/(${OWNER_RE})/(${REPO_RE}?)(\\.git)?(?:/tree/(.+))?$`);

// --- ref validation -------------------------------------------------------
//
// The `/tree/<ref>` segment of a GitHub URL is still percent-encoded when
// it comes out of GITHUB_PATH_RE (URL#pathname never decodes it). A ref
// is later passed as a positional argument to `git fetch`, so validating
// the still-encoded string (as an earlier version of this file did, by
// checking refRaw.startsWith('-') / .includes('..') before decoding) is
// a real injection hole: "%2D%2Dupload-pack%3D/tmp/pwn.sh" passes those
// checks encoded, then decodes to "--upload-pack=/tmp/pwn.sh", which git
// parses as an option, not a ref. validateRef() always decodes FIRST and
// validates the decoded value; callers must never use refRaw directly.
const REF_MAX_LENGTH = 200;
const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i;
const REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
// Control characters (including NUL, tab, newline, DEL) and plain ASCII
// space -- a ref has no legitimate use for any of them.
const CONTROL_OR_WHITESPACE_RE = /[\x00-\x20\x7f]/;

function validateRef(rawEncodedRef) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawEncodedRef);
  } catch {
    throw new Error('git-map: ref has invalid percent-encoding.');
  }

  if (decoded.length === 0) {
    throw new Error('git-map: ref must not be empty.');
  }
  if (decoded.length > REF_MAX_LENGTH) {
    throw new Error(`git-map: ref is ${decoded.length} characters, must be ${REF_MAX_LENGTH} or fewer.`);
  }
  // A decoded ref that still contains "%" was double-encoded
  // ("%252D" -> "%2D") -- one decode pass was not enough to see its real
  // content, so it is rejected rather than decoded again.
  if (decoded.includes('%')) {
    throw new Error('git-map: ref must not contain "%" after decoding (double-encoded refs are rejected).');
  }
  if (CONTROL_OR_WHITESPACE_RE.test(decoded)) {
    throw new Error('git-map: ref must not contain control or whitespace characters.');
  }
  if (decoded.startsWith('-')) {
    throw new Error('git-map: ref must not start with "-" (would be parsed as a git option).');
  }

  // A full or abbreviated hex commit SHA is always accepted.
  if (HEX_SHA_RE.test(decoded)) return decoded;

  // Otherwise, a git-style branch/tag name: see `git check-ref-format`
  // for the real rule set -- this is a conservative allow-list subset of
  // it, not a full reimplementation.
  if (
    !REF_NAME_RE.test(decoded) ||
    decoded.includes('..') ||
    decoded.includes('//') ||
    decoded.includes('@{') ||
    decoded.includes('\\') ||
    decoded.endsWith('/') ||
    decoded.endsWith('.') ||
    decoded.split('/').some(segment => segment.endsWith('.lock'))
  ) {
    throw new Error(`git-map: ref ${JSON.stringify(truncateForError(decoded))} is not a valid git ref.`);
  }

  return decoded;
}

async function resolveLocalPath(rawInput) {
  const resolved = path.resolve(rawInput);
  let real;
  try {
    real = await fsp.realpath(resolved);
  } catch {
    throw new Error(`git-map: local path "${truncateForError(rawInput)}" does not exist.`);
  }
  let st;
  try {
    st = await fsp.stat(real);
  } catch {
    throw new Error(`git-map: local path "${truncateForError(rawInput)}" does not exist.`);
  }
  if (!st.isDirectory()) {
    throw new Error(`git-map: local path "${truncateForError(rawInput)}" is not a directory.`);
  }
  return { type: 'local', path: real, name: path.basename(real) };
}

function resolveGithubUrl(rawInput) {
  let url;
  try {
    url = new URL(rawInput);
  } catch {
    throw new Error(`git-map: "${truncateForError(rawInput)}" is not a valid local path or GitHub URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`git-map: only https:// GitHub URLs are supported (got scheme "${truncateForError(url.protocol)}").`);
  }
  if (url.hostname !== 'github.com') {
    throw new Error(`git-map: only https://github.com/<owner>/<repo> URLs are supported (got host "${truncateForError(url.hostname)}").`);
  }
  if (url.username || url.password) {
    throw new Error('git-map: a GitHub URL must not carry credentials.');
  }
  if (url.search) {
    throw new Error('git-map: a GitHub URL must not carry a query string.');
  }
  if (url.pathname.includes('..')) {
    throw new Error('git-map: a GitHub URL must not contain "..".');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  const m = GITHUB_PATH_RE.exec(pathname);
  if (!m || !m[2]) {
    throw new Error(
      `git-map: "${truncateForError(rawInput)}" is not a URL of the form https://github.com/<owner>/<repo>[/tree/<ref>].`,
    );
  }

  const [, owner, repo, , refRaw] = m;
  if (repo === '.' || repo === '..') {
    throw new Error(`git-map: invalid repository name in "${truncateForError(rawInput)}".`);
  }

  const ref = refRaw ? validateRef(refRaw) : null;

  return { type: 'github', owner, repo, ref, name: repo };
}

// Resolves a scan source. A local path must already exist and be a
// directory; it is resolved to its real path. A GitHub URL must be
// exactly `https://github.com/<owner>/<repo>`, optionally with `.git`
// and/or a `/tree/<ref>` suffix. Everything else -- other hosts, other
// schemes (ssh://, git://, file://), scp-style `git@host:` syntax,
// embedded credentials, `..`, and query strings -- is rejected with a
// specific error.
async function resolveSource(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('git-map: source must be a non-empty local path or GitHub URL.');
  }
  const trimmed = input.trim();

  if (SCP_LIKE_RE.test(trimmed)) {
    throw new Error(`git-map: scp-style git URLs ("${truncateForError(trimmed)}") are not supported; use https://github.com/<owner>/<repo>.`);
  }
  if (!SCHEME_RE.test(trimmed)) {
    return resolveLocalPath(trimmed);
  }
  return resolveGithubUrl(trimmed);
}

// --- clone --------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200MB

// The exact safe-clone posture from the design doc, reproduced as a
// literal array so cloneGitHub()'s tests can assert on it precisely.
// GIT_LFS_SKIP_SMUDGE=1 stops a globally installed git-lfs filter from
// downloading LFS objects during checkout -- fetching arbitrary content
// from a third-party LFS endpoint is exactly the kind of side effect the
// design doc's "never execute/fetch anything the repo doesn't have to"
// posture rules out.
const GIT_SAFE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ASKPASS: '',
  GIT_LFS_SKIP_SMUDGE: '1',
};

// protocol.allow=never plus an explicit protocol.https.allow=always
// switches every transport to deny-by-default and re-allows only the one
// this module ever uses; protocol.file.allow / protocol.ext.allow=never
// are kept too as belt-and-braces since they predate the deny-by-default
// pair. submodule.recurse=false is a second, config-level backstop
// behind --no-recurse-submodules (which only applies to `clone`, not the
// init+fetch+checkout path used for a pinned ref). core.fsmonitor=false
// stops git from launching a filesystem-watcher hook process.
const GIT_SAFE_CONFIG_ARGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'protocol.file.allow=never',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'core.symlinks=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
];

function buildEnv() {
  return { ...process.env, ...GIT_SAFE_ENV };
}

// Default runGit: child_process.execFile with an argument array (never a
// shell), so nothing in `args` -- however it got there -- is ever
// interpreted by a shell.
function defaultRunGit(args, { cwd, env, timeoutMs }) {
  return new Promise(resolve => {
    execFile('git', args, { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
        timedOut: !!(error && error.killed),
        error: error || null,
      });
    });
  });
}

// Sums the byte size of every regular file under `dir`, never following
// symlinks (a symlink counts as 0 bytes toward the budget rather than
// being dereferenced, matching the "never follow symlinks" posture used
// throughout the scan step too).
async function dirSizeBytes(dir) {
  let total = 0;
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const st = await fsp.stat(full);
          total += st.size;
        } catch {
          /* file vanished mid-walk: ignore */
        }
      }
    }
  }
  await walk(dir);
  return total;
}

async function removeQuietly(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    /* best-effort cleanup */
  }
}

// Clones a GitHub repo shallow and read-only into a fresh temp directory.
// { path, cleanup() } is returned on success; cleanup() removes the temp
// directory (idempotent, safe to call more than once). On any failure --
// git error, timeout, or exceeding maxBytes -- the temp directory is
// always removed before the error is thrown.
//
// `runGit` is injectable ((args, { cwd, env, timeoutMs }) => Promise<{code,
// stdout, stderr, timedOut}>) precisely so unit tests can assert on the
// exact argument/env shape without ever invoking a real `git` process or
// touching the network.
async function cloneGitHub(
  { owner, repo, ref },
  { tmpRoot, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, runGit = defaultRunGit } = {},
) {
  // Defence in depth: re-validate even an already-decoded ref. A ref
  // that passed validateRef() once contains no "%", so a second decode
  // pass here is a no-op for a legitimate caller (resolveSource());
  // this only matters for a caller that reaches cloneGitHub() directly
  // with an untrusted ref, bypassing resolveSource() entirely.
  const safeRef = ref ? validateRef(ref) : null;

  const root = tmpRoot || os.tmpdir();
  await fsp.mkdir(root, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(root, 'sequentdraw-git-map-'));

  const env = buildEnv();
  const url = `https://github.com/${owner}/${repo}.git`;
  const deadline = Date.now() + timeoutMs;
  const remainingMs = () => Math.max(1000, deadline - Date.now());

  async function run(args) {
    const result = await runGit(args, { cwd: workDir, env, timeoutMs: remainingMs() });
    if (result.timedOut) {
      throw new Error(`git-map: clone of ${owner}/${repo} timed out after ${timeoutMs}ms.`);
    }
    if (result.code !== 0) {
      throw new Error(`git-map: git ${args.join(' ')} failed (exit ${result.code}): ${truncateForError(result.stderr.trim())}`);
    }
    return result;
  }

  try {
    if (safeRef) {
      await run([...GIT_SAFE_CONFIG_ARGS, 'init', workDir]);
      await run([
        ...GIT_SAFE_CONFIG_ARGS,
        '-C',
        workDir,
        'fetch',
        '--depth',
        '1',
        '--no-tags',
        '--filter=blob:limit=1m',
        '--',
        url,
        safeRef,
      ]);
      // The ref is never passed to checkout: FETCH_HEAD already points at
      // exactly the commit `fetch` just resolved it to, so there is no
      // second place for a validated-but-still-attacker-influenced ref
      // string to reach a git invocation as an argument.
      await run([...GIT_SAFE_CONFIG_ARGS, '-C', workDir, 'checkout', '--detach', 'FETCH_HEAD']);
    } else {
      await run([
        ...GIT_SAFE_CONFIG_ARGS,
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        '--no-recurse-submodules',
        '--filter=blob:limit=1m',
        '--',
        url,
        workDir,
      ]);
    }

    const size = await dirSizeBytes(workDir);
    if (size > maxBytes) {
      throw new Error(`git-map: clone of ${owner}/${repo} is ${size} bytes, exceeding the ${maxBytes}-byte limit.`);
    }

    let resolvedRef = safeRef || null;
    if (!resolvedRef) {
      const head = await run([...GIT_SAFE_CONFIG_ARGS, '-C', workDir, 'rev-parse', 'HEAD']);
      resolvedRef = head.stdout.trim() || null;
    }

    let cleaned = false;
    return {
      path: workDir,
      ref: resolvedRef,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        await removeQuietly(workDir);
      },
    };
  } catch (err) {
    await removeQuietly(workDir);
    throw err;
  }
}

module.exports = {
  resolveSource,
  cloneGitHub,
  validateRef,
  GIT_SAFE_ENV,
  GIT_SAFE_CONFIG_ARGS,
  dirSizeBytes,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
};
