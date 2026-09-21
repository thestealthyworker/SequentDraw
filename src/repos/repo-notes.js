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
//
// Link extraction lives in ./repo-links.js, and the comment at the top of
// that file is the one to read before touching any of this: a link the
// renderer publishes but the checker cannot classify is the bug class this
// whole module exists to prevent.

const { parseRepoId, repoKey } = require('./repo-id');
const { repoLinksIn } = require('./repo-links');

const MAX_REPOS_PER_NOTE = 3;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the file `--repos` names. Returns { index } (a lookup from
 * lower-cased id to entry) or { errors } carrying one invalid-repos-file
 * error. The index is a null-prototype object: repository ids come from a
 * file on disk, and "__proto__" is a legal GitHub repository name.
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
    const parsed = typeof entry.id === 'string' ? parseRepoId(entry.id) : null;
    if (!parsed) {
      return invalid(`repos[${i}].id must be a bare "owner/repo" identifier.`);
    }
    if (typeof entry.usable !== 'boolean') {
      return invalid(`repos[${i}].usable must be true or false.`);
    }
    // Indexed by the PARSED id, so a hand-written " owner/repo " or
    // "owner/repo.git" lands under the key a link can actually produce.
    index[repoKey(parsed.id)] = entry;
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

  // Collected per note and flushed in note order at the end, so the errors
  // come back in document order whatever order the rules ran in.
  const perNote = new Map();
  const push = (i, error) => {
    const list = perNote.get(i) || [];
    list.push(error);
    perNote.set(i, list);
  };

  const notes = Array.isArray(doc.notes) ? doc.notes : [];

  // One repository note per node, counted across the whole document: three
  // links in one note, not three notes crowding one place on the canvas.
  const notesPerTarget = new Map();

  notes.forEach((note, i) => {
    const { links, unparsable } = repoLinksIn(note && note.content);
    if (links.length === 0 && unparsable.length === 0) return;
    const at = `/notes/${i}`;

    // A github.com link naming two path segments that are not a legal
    // repository cannot be verified, and is refused rather than ignored.
    // Silently dropping it is how an unverified link reaches the reader.
    unparsable.forEach(raw => {
      push(i, {
        path: `${at}/content`,
        message: `"${raw.slice(0, 120)}" points at github.com but does not name a repository that can be verified; remove it or write it as https://github.com/<owner>/<repo>.`,
        code: 'repo-unverified',
      });
    });

    const total = links.length + unparsable.length;
    if (total > MAX_REPOS_PER_NOTE) {
      push(i, {
        path: `${at}/content`,
        message: `a repository note links to ${total} repositories; at most ${MAX_REPOS_PER_NOTE} are allowed on one node.`,
        code: 'repo-too-many',
      });
    }

    links.forEach(id => {
      const entry = index[repoKey(id)];
      if (!entry) {
        push(i, {
          path: `${at}/content`,
          message: `"${id}" was not verified in this run; run "sequentdraw licences ${id} --out <file>" and pass that file to --repos, or remove the link.`,
          code: 'repo-unverified',
        });
        return;
      }
      if (entry.usable !== true) {
        const why = typeof entry.reason === 'string' ? ` (${entry.reason})` : '';
        push(i, {
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
      push(i, {
        path: `/notes/${i}/attachTo`,
        message: `"${target}" already carries a repository note (/notes/${indexes[0]}); put every candidate for one node in one note.`,
        code: 'repo-notes-per-node',
      });
    });
  }

  return [...perNote.keys()].sort((a, b) => a - b).flatMap(i => perNote.get(i));
}

module.exports = { checkRepoNotes, repoLinksIn, readVerified, MAX_REPOS_PER_NOTE };
