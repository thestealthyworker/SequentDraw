// Parsing and recognising "owner/repo", shared by the verifier
// (src/repos/licences.js) and by the note rules that read links back out of
// a map (src/repos/repo-notes.js).
//
// The charset rules are the ones src/scan/acquire.js already applies to a
// GitHub URL, repeated here rather than imported because acquire.js parses a
// URL for cloning and this parses an identifier for an API path. The two
// have different jobs and must be allowed to diverge; what they must NOT do
// is disagree about what a legal owner or repo name looks like, which is why
// the expressions below are written identically and asserted equal in
// tests/repos-licences.test.js.
//
// Nothing here ever builds a URL from raw user text: an id that does not
// match these expressions exactly is refused before any request is made
// (docs/design/gitrepo-suggest.md section 4).

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// A repo name of "." or ".." would build a path that traverses; GitHub does
// not allow either as a repository name, and neither do we.
const DOT_ONLY_RE = /^\.+$/;

// Anything that is not a bare owner/repo: a scheme, a query, a fragment, a
// percent escape (which would decode into a path segment inside the API
// path), whitespace or a control character.
const NOT_BARE_RE = /[\x00-\x20\x7f:?#%\\]/;

/**
 * Parse "owner/repo" into its parts. Returns null for anything else --
 * a URL, an extra path segment, a percent escape, an over-long owner.
 */
function parseRepoId(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || NOT_BARE_RE.test(value)) return null;

  const parts = value.split('/');
  if (parts.length !== 2) return null;

  const [owner, repoRaw] = parts;
  // A trailing ".git" is how a clone URL spells the same repository; accept
  // it and strip it, so a candidate copied from a git remote still verifies.
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw;

  if (!OWNER_RE.test(owner)) return null;
  if (!REPO_RE.test(repo) || DOT_ONLY_RE.test(repo)) return null;

  return { owner, repo, id: `${owner}/${repo}` };
}

// GitHub compares owner and repo names case-insensitively, so two spellings
// of one repository are one repository for "at most three per node" and for
// "is this in the verified file".
function repoKey(id) {
  return String(id).toLowerCase();
}

module.exports = { parseRepoId, repoKey, OWNER_RE, REPO_RE };
