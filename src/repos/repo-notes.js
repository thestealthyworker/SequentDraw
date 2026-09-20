// The rules `sequentdraw check --repos <verified.json>` enforces on a map
// that carries repository candidates (docs/design/gitrepo-suggest.md
// section 3).
//
// The shape of the guarantee is the same as check --evidence's: the host AI
// does the reasoning about which repository suits which node, and the engine
// refuses the result when it links to a repository that was not verified in
// this run. A model cannot talk its way past it, and the CLI and every other
// surface get the same refusal.
//
// A candidate is a NOTE, not a node. A node would claim the repository is
// part of the system; a note says someone could use it.
//
// --repos is optional, and without it a map carrying repository notes is not
// refused: check cannot know a note is a recommendation. The skill is what
// always passes it, and its eval asserts that it does.

const { parseRepoId, repoKey } = require('./repo-id');

const MAX_REPOS_PER_NOTE = 3;

// Any github.com link in a note's markdown, whether it is a bare URL or the
// target of a [text](url) link. Only the first two path segments matter: a
// link to a file inside a repository still names that repository.
const GITHUB_LINK_RE = /https?:\/\/(?:www\.)?github\.com\/([^\s)\]"'<>]+)/gi;

/**
 * Every distinct repository a note's content links to, in the order they
 * first appear. A link with a path that is not a legal owner/repo (a search
 * URL, a user profile, an organisation page) is not a repository link and is
 * ignored -- a note may reasonably link to github.com itself.
 */
function repoLinksIn(content) {
  if (typeof content !== 'string') return [];
  const found = [];
  const seen = new Set();
  for (const match of content.matchAll(GITHUB_LINK_RE)) {
    const segments = match[1].split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const parsed = parseRepoId(`${segments[0]}/${segments[1]}`);
    if (!parsed) continue;
    const key = repoKey(parsed.id);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(parsed.id);
  }
  return found;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the file `--repos` names. Returns { index } (a lookup from
 * lower-cased id to entry) or { errors } carrying one invalid-repos-file
 * error. The index is a null-prototype object: repository ids come from a
 * file on disk, and "__proto__" is a legal GitHub owner name.
 */
function readVerified(value) {
  const invalid = message => ({
    errors: [{ path: '/', message: `--repos: ${message}`, code: 'invalid-repos-file' }],
  });

  if (!isPlainObject(value)) return invalid('the file must be a JSON object.');
  if (!Array.isArray(value.repos)) return invalid('the file must carry a "repos" array.');

  const index = Object.create(null);
  for (let i = 0; i < value.repos.length; i++) {
    const entry = value.repos[i];
    if (!isPlainObject(entry)) return invalid(`repos[${i}] must be an object.`);
    if (typeof entry.id !== 'string' || !parseRepoId(entry.id)) {
      return invalid(`repos[${i}].id must be a bare "owner/repo" identifier.`);
    }
    if (typeof entry.usable !== 'boolean') {
      return invalid(`repos[${i}].usable must be true or false.`);
    }
    index[repoKey(entry.id)] = entry;
  }
  return { index };
}

/**
 * Check a validated document's notes against the verified file.
 *
 * `doc` is the normalised document; `verified` is the parsed contents of
 * --repos. Returns an array of { path, message, code } in document order,
 * empty when the map passes.
 */
function checkRepoNotes(doc, verified) {
  const read = readVerified(verified);
  if (read.errors) return read.errors;
  const index = read.index;

  const errors = [];
  const notes = Array.isArray(doc.notes) ? doc.notes : [];

  // One repository note per node, counted across the whole document: three
  // links in one note, not three notes crowding one place on the canvas.
  const notesPerTarget = new Map();

  notes.forEach((note, i) => {
    const links = repoLinksIn(note && note.content);
    if (links.length === 0) return;
    const at = `/notes/${i}`;

    if (links.length > MAX_REPOS_PER_NOTE) {
      errors.push({
        path: `${at}/content`,
        message: `a repository note links to ${links.length} repositories; at most ${MAX_REPOS_PER_NOTE} are allowed on one node.`,
        code: 'repo-too-many',
      });
    }

    links.forEach(id => {
      const entry = index[repoKey(id)];
      if (!entry) {
        errors.push({
          path: `${at}/content`,
          message: `"${id}" was not verified in this run; run "sequentdraw licences ${id} --out <file>" and pass that file to --repos, or remove the link.`,
          code: 'repo-unverified',
        });
        return;
      }
      if (entry.usable !== true) {
        const why = typeof entry.reason === 'string' ? ` (${entry.reason})` : '';
        errors.push({
          path: `${at}/content`,
          message: `"${id}" is marked unusable in --repos${why}; it must not be recommended.`,
          code: 'repo-not-usable',
        });
      }
    });

    const targets = Array.isArray(note.attachTo) ? note.attachTo : [];
    targets.forEach(target => {
      const list = notesPerTarget.get(target) || [];
      list.push(i);
      notesPerTarget.set(target, list);
    });
  });

  for (const [target, indexes] of notesPerTarget) {
    if (indexes.length <= 1) continue;
    // Reported against the second and any later note, because the first one
    // is the one to keep.
    indexes.slice(1).forEach(i => {
      errors.push({
        path: `/notes/${i}/attachTo`,
        message: `"${target}" already carries a repository note (/notes/${indexes[0]}); put every candidate for one node in one note.`,
        code: 'repo-notes-per-node',
      });
    });
  }

  return errors;
}

module.exports = { checkRepoNotes, repoLinksIn, readVerified, MAX_REPOS_PER_NOTE };
