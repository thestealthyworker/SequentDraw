// `sequentdraw check --repos`: the five codes of
// docs/design/gitrepo-suggest.md section 3, the link extraction they rest
// on, and the end-to-end CLI behaviour.
//
// The guarantee under test is the one that makes the whole step worth
// having: a map may not recommend a repository that was not verified in
// this run. A model cannot talk its way past it, because the refusal is the
// engine's and not the skill's.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkRepoNotes, repoLinksIn, MAX_REPOS_PER_NOTE } = require('../src/repos/repo-notes');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-repos-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A minimal map that passes validateDoc and carries no business layer, so
// the completeness rules stay out of these tests: what is being pinned here
// is the repository rules and nothing else.
function mapWith(notes) {
  return {
    title: 'Repo candidates',
    nodes: [
      { id: 'a', label: 'Enquiry arrives', kind: 'external' },
      { id: 'b', label: 'Chase the customer', kind: 'manual' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
    notes,
  };
}

function note(over = {}) {
  return {
    id: 'n_repo_b',
    attachTo: ['b'],
    color: 'blue',
    content:
      '**Could fill this gap**\n\n[owner/repo](https://github.com/owner/repo) — MIT, 1.8k stars. Sends a reminder on a schedule.\n\nNot a hosted service: someone has to run and update it.',
    ...over,
  };
}

function verified(repos) {
  return { checkedAt: '2026-09-20T00:00:00Z', repos };
}

const USABLE = { id: 'owner/repo', url: 'https://github.com/owner/repo', usable: true, spdx: 'MIT' };

// ------------------------------------------------------- reading the links

test('a markdown link, a bare URL and a deep link all name their repository', () => {
  const links = c => repoLinksIn(c).links;
  assert.deepStrictEqual(links('[x](https://github.com/owner/repo)'), ['owner/repo']);
  assert.deepStrictEqual(links('see https://github.com/owner/repo for more'), ['owner/repo']);
  assert.deepStrictEqual(links('https://github.com/owner/repo/blob/main/README.md'), ['owner/repo']);
  assert.deepStrictEqual(links('https://www.github.com/owner/repo'), ['owner/repo']);
});

test('one repository linked twice in a note counts once', () => {
  const { links } = repoLinksIn(
    '[a](https://github.com/Owner/Repo) and [b](https://github.com/owner/repo/issues/3)',
  );
  assert.deepStrictEqual(links, ['Owner/Repo']);
});

test('a link that is not a repository is not a repository link', () => {
  // A profile, an organisation page, a search, and github.com itself: a note
  // may reasonably link to any of them without claiming a recommendation.
  for (const url of [
    'https://github.com/owner',
    'https://github.com',
    'https://github.com/search?q=cron',
    'https://gitlab.com/owner/repo',
  ]) {
    assert.deepStrictEqual(repoLinksIn(url), { links: [], unparsable: [] }, url);
  }
});

test('a note with no repository link is not a repository note', () => {
  const errors = checkRepoNotes(mapWith([note({ content: 'Consider: nobody chases this.' })]), verified([]));
  assert.deepStrictEqual(errors, []);
});

// ------------------------------------------------------------- the five codes

test('a link to a repository absent from --repos is repo-unverified', () => {
  const errors = checkRepoNotes(mapWith([note()]), verified([]));
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'repo-unverified');
  assert.strictEqual(errors[0].path, '/notes/0/content');
  // The refusal says how to satisfy it, not just that it failed.
  assert.match(errors[0].message, /sequentdraw licences owner\/repo/);
});

test('a link to a repository marked unusable is repo-not-usable, with the reason', () => {
  const errors = checkRepoNotes(
    mapWith([note()]),
    verified([{ id: 'owner/repo', usable: false, reason: 'licence-not-mit' }]),
  );
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'repo-not-usable');
  assert.match(errors[0].message, /licence-not-mit/);
});

test('more than three repositories in one note is repo-too-many', () => {
  const content = ['one', 'two', 'three', 'four']
    .map((n, i) => `[${n}](https://github.com/owner/r${i})`)
    .join('\n');
  const repos = [0, 1, 2, 3].map(i => ({ id: `owner/r${i}`, usable: true }));
  const errors = checkRepoNotes(mapWith([note({ content })]), verified(repos));
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'repo-too-many');
  assert.match(errors[0].message, new RegExp(`at most ${MAX_REPOS_PER_NOTE}`));
});

test('exactly three repositories in one note is allowed', () => {
  const content = [0, 1, 2].map(i => `[r](https://github.com/owner/r${i})`).join('\n');
  const repos = [0, 1, 2].map(i => ({ id: `owner/r${i}`, usable: true }));
  assert.deepStrictEqual(checkRepoNotes(mapWith([note({ content })]), verified(repos)), []);
});

test('two repository notes on one node is repo-notes-per-node, reported against the second', () => {
  const errors = checkRepoNotes(
    mapWith([note(), note({ id: 'n_repo_b2' })]),
    verified([USABLE]),
  );
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'repo-notes-per-node');
  assert.strictEqual(errors[0].path, '/notes/1/attachTo');
  assert.match(errors[0].message, /\/notes\/0/);
});

test('one repository note per node on two different nodes is allowed', () => {
  const errors = checkRepoNotes(
    mapWith([note(), note({ id: 'n_repo_a', attachTo: ['a'] })]),
    verified([USABLE]),
  );
  assert.deepStrictEqual(errors, []);
});

test('a repository note and a plain note on the same node do not collide', () => {
  const errors = checkRepoNotes(
    mapWith([note(), { id: 'n_plain', attachTo: ['b'], content: 'Twice a week, by hand.' }]),
    verified([USABLE]),
  );
  assert.deepStrictEqual(errors, []);
});

for (const [label, value] of [
  ['not an object', []],
  ['no repos array', { checkedAt: 'x' }],
  ['a non-object entry', { repos: ['owner/repo'] }],
  ['an id that is not owner/repo', { repos: [{ id: 'https://github.com/o/r', usable: true }] }],
  ['a usable that is not a boolean', { repos: [{ id: 'owner/repo', usable: 'yes' }] }],
]) {
  test(`--repos with ${label} is invalid-repos-file`, () => {
    const errors = checkRepoNotes(mapWith([note()]), value);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'invalid-repos-file');
  });
}

test('a map whose notes link only to usable repositories passes', () => {
  assert.deepStrictEqual(checkRepoNotes(mapWith([note()]), verified([USABLE])), []);
});

test('the verified index survives a repository named __proto__', () => {
  // GitHub allows "__proto__" as a REPOSITORY name (an owner name may not
  // start with an underscore, which is why this is the repo half). A plain
  // {} index would report it as verified when nobody verified it. Same
  // defence as the correction operations (src/n8n/correct-ops.js).
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const hostile = mapWith([note({ content: `[x](https://github.com/owner/${name})` })]);

    const errors = checkRepoNotes(hostile, verified([USABLE]));
    assert.strictEqual(errors.length, 1, `owner/${name} must not be verified by inheritance`);
    assert.strictEqual(errors[0].code, 'repo-unverified');

    const listed = checkRepoNotes(hostile, verified([{ id: `owner/${name}`, usable: true }]));
    assert.deepStrictEqual(listed, [], `owner/${name} must pass once it is actually listed`);
  }
});

test('a repository is matched case-insensitively, as GitHub matches it', () => {
  const errors = checkRepoNotes(
    mapWith([note({ content: '[x](https://github.com/Owner/Repo)' })]),
    verified([USABLE]),
  );
  assert.deepStrictEqual(errors, []);
});

// ------------------------------------------------------------- through the CLI

test('check --repos refuses an unverified link and exits 1', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const reposPath = path.join(dir, 'repos.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([note()])));
    fs.writeFileSync(reposPath, JSON.stringify(verified([])));

    const result = spawnSync(process.execPath, [BIN, 'check', mapPath, '--repos', reposPath], {
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /was not verified in this run/);
    assert.strictEqual(result.stdout, '');
  });
});

test('check --repos passes a map whose links are all verified', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const reposPath = path.join(dir, 'repos.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([note()])));
    fs.writeFileSync(reposPath, JSON.stringify(verified([USABLE])));

    const result = spawnSync(process.execPath, [BIN, 'check', mapPath, '--repos', reposPath], {
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, 'ok\n');
  });
});

test('without --repos, a map carrying repository notes is not refused', () => {
  // check cannot know a note is a recommendation; the skill is what always
  // passes --repos, and its eval asserts that it does.
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([note()])));
    const result = spawnSync(process.execPath, [BIN, 'check', mapPath], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, 'ok\n');
  });
});

test('--repos applies to the merged document, not the one on disk', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const reposPath = path.join(dir, 'repos.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([])));
    fs.writeFileSync(reposPath, JSON.stringify(verified([])));
    const patch = JSON.stringify({ notes: [note()] });

    const result = spawnSync(
      process.execPath,
      [BIN, 'check', mapPath, '--merge', '-', '--repos', reposPath],
      { encoding: 'utf8', input: patch },
    );
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /repo-unverified|was not verified/);
  });
});

test('--repos nothing is written by --emit-open when a repository link is refused', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const reposPath = path.join(dir, 'repos.json');
    const outPath = path.join(dir, 'next.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([note()])));
    fs.writeFileSync(reposPath, JSON.stringify(verified([])));

    const result = spawnSync(
      process.execPath,
      [BIN, 'check', mapPath, '--repos', reposPath, '--emit-open', outPath],
      { encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 1);
    assert.strictEqual(fs.existsSync(outPath), false);
  });
});

test('--repos - is refused: stdin is only for the map', () => {
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([])));
    const result = spawnSync(process.execPath, [BIN, 'check', mapPath, '--repos', '-'], {
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--repos must be a real file/);
  });
});

test('check --help documents --repos', () => {
  const result = spawnSync(process.execPath, [BIN, 'check', '--help'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /--repos <file>/);
});

// ------------------------------------ the invariant the CRITICAL bug broke

// The first version of the link extractor used its own regex and then split
// the string on "/". Six URL shapes slipped through -- `?tab=readme-ov-file`,
// `#readme`, `:443`, `user@`, a backslash separator, a percent-escaped owner
// -- because the extracting regex accepted characters the id parser then
// rejected, and a link that failed to parse was treated as "not a link". The
// renderer published every one as a working <a href>, so a reader could click
// through to a repository nobody verified.
//
// A list of those six cases is not the test worth having: re-tightening a
// regex without pinning the rule just moves the next hole somewhere else. The
// rule is that the checker must SEE every github.com link the renderer
// PUBLISHES. That is asserted directly below, against the renderer's own
// code, so it keeps holding when either side changes.

const { escapeHtml, parseInline } = require('../src/n8n/markdown');
const { repoLinksIn: readLinks, repoPathOf } = require('../src/repos/repo-links');

// Every href the renderer would actually emit for this content. Mirrors
// src/n8n/notes.js: escape each raw line first, then parse inline runs.
function renderedHrefs(content) {
  return String(content)
    .split('\n')
    .flatMap(line => parseInline(escapeHtml(line)))
    .filter(run => run.href)
    // The renderer's hrefs are HTML-escaped; undo the one entity a URL can
    // legitimately carry so both sides compare the same address.
    .map(run => run.href.replace(/&amp;/g, '&'));
}

const HOSTILE_LINKS = [
  'https://github.com/evil/repo',
  'https://github.com/evil/repo?tab=readme-ov-file',
  'https://github.com/evil/repo#readme',
  'https://github.com:443/evil/repo',
  'https://user@github.com/evil/repo',
  'https://github.com\\evil\\repo',
  'https://github.com/evil%2Dorg/repo',
  'https://github.com./evil/repo',
  'https://www.github.com/evil/repo',
  'https://GitHub.COM/evil/repo',
  'https://github.com/evil/repo/blob/main/README.md',
  'https://github.com/evil/repo.git',
  'https://github.com/evil/repo/',
  'http://github.com/evil/repo',
  'https://github.com/evil/repo?a=1&b=2',
];

test('every github.com link the renderer publishes is seen by the checker', () => {
  for (const url of HOSTILE_LINKS) {
    for (const content of [`[see this](${url})`, `look at ${url} for more`]) {
      const hrefs = renderedHrefs(content);
      const { links, unparsable } = readLinks(content);

      hrefs.forEach(href => {
        if (repoPathOf(href) == null) return; // not a repository link at all
        const seen = links.length > 0 || unparsable.length > 0;
        assert.ok(
          seen,
          `the renderer publishes ${href} but the checker sees nothing, for content: ${content}`,
        );
      });
    }
  }
});

test('each of the six shapes that bypassed the check is now refused', () => {
  for (const url of HOSTILE_LINKS) {
    const errors = checkRepoNotes(
      mapWith([note({ content: `[fill this gap](${url}) — someone has to run it.` })]),
      verified([USABLE]),
    );
    assert.strictEqual(errors.length, 1, `${url} produced ${errors.length} errors`);
    assert.strictEqual(errors[0].code, 'repo-unverified', `${url} was not refused`);
  }
});

test('the same shapes pass once the repository they name is verified', () => {
  for (const url of HOSTILE_LINKS) {
    // The percent-escaped one names a DIFFERENT repository: %2D decodes to a
    // hyphen, so github.com/evil%2Dorg/repo reaches evil-org/repo. Verifying
    // evil/repo must not clear it, which is the whole point of decoding.
    const names = url.includes('%2D') ? 'evil-org/repo' : 'evil/repo';
    const errors = checkRepoNotes(
      mapWith([note({ content: `[fill this gap](${url})` })]),
      verified([{ id: names, usable: true }]),
    );
    assert.deepStrictEqual(errors, [], `${url} was refused although ${names} is verified`);
  }
});

test('a percent escape is decoded to the repository GitHub would serve', () => {
  const { links } = readLinks('[x](https://github.com/evil%2Dorg/repo)');
  assert.deepStrictEqual(links, ['evil-org/repo']);
  // and verifying the un-decoded spelling does not clear it
  const errors = checkRepoNotes(
    mapWith([note({ content: '[x](https://github.com/evil%2Dorg/repo)' })]),
    verified([{ id: 'evil/repo', usable: true }]),
  );
  assert.strictEqual(errors[0].code, 'repo-unverified');
});

test('a github.com link naming two segments that are not a repository is refused, not ignored', () => {
  // "I could not classify this" must never come out as "there was nothing
  // here": that silent drop is exactly how an unverified link reached the
  // reader. A space is percent-encoded by the URL parser and decodes back to
  // a name no repository can have.
  const errors = checkRepoNotes(
    mapWith([note({ content: '[x](https://github.com/owner/re po)' })]),
    verified([USABLE]),
  );
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].code, 'repo-unverified');
  assert.match(errors[0].message, /does not name a repository that can be verified/);
});

test('hidden links still count toward the three-per-note cap', () => {
  // The cap was defeated the same way the verification was: a link the
  // checker could not see did not count.
  const content = [
    '[a](https://github.com/owner/r0)',
    '[b](https://github.com/owner/r1)',
    '[c](https://github.com/owner/r2)',
    '[d](https://github.com/owner/r3?tab=readme-ov-file)',
  ].join('\n');
  const repos = [0, 1, 2, 3].map(i => ({ id: `owner/r${i}`, usable: true }));
  const errors = checkRepoNotes(mapWith([note({ content })]), verified(repos));
  assert.ok(errors.some(e => e.code === 'repo-too-many'), 'the fourth link must count');
});

test('a note whose only links are hidden still counts for one-note-per-node', () => {
  const hidden = 'https://github.com/owner/repo#readme';
  const errors = checkRepoNotes(
    mapWith([
      note({ content: `[a](${hidden})` }),
      note({ id: 'n_repo_b2', content: `[b](${hidden})` }),
    ]),
    verified([USABLE]),
  );
  assert.ok(errors.some(e => e.code === 'repo-notes-per-node'), 'the second note must be seen');
});

test('errors come back in document order', () => {
  const errors = checkRepoNotes(
    mapWith([
      note({ id: 'n_a', attachTo: ['a'], content: '[x](https://github.com/owner/missing)' }),
      note({ id: 'n_b', attachTo: ['b'] }),
      note({ id: 'n_b2', attachTo: ['b'] }),
    ]),
    verified([USABLE]),
  );
  const paths = errors.map(e => e.path);
  const sorted = [...paths].sort(
    (x, y) => Number(x.split('/')[2]) - Number(y.split('/')[2]),
  );
  assert.deepStrictEqual(paths, sorted, `out of order: ${paths.join(', ')}`);
});

test('a verified file may spell an id with .git or surrounding space', () => {
  // The index is keyed by the PARSED id, so a hand-written file still
  // matches the link. It fails closed either way, but the trap is gone.
  for (const id of ['owner/repo.git', '  owner/repo  ']) {
    assert.deepStrictEqual(
      checkRepoNotes(mapWith([note()]), verified([{ id, usable: true }])),
      [],
      `${JSON.stringify(id)} should index under owner/repo`,
    );
  }
});

test('a non-repository github.com link is still not a recommendation', () => {
  // A profile, an organisation page or a search names fewer than two path
  // segments, so it recommends no repository and must not be refused.
  for (const url of [
    'https://github.com/owner',
    'https://github.com',
    'https://github.com/search?q=cron',
    'https://gitlab.com/owner/repo',
  ]) {
    assert.deepStrictEqual(
      checkRepoNotes(mapWith([note({ content: `[x](${url})` })]), verified([])),
      [],
      `${url} should not be treated as a repository recommendation`,
    );
  }
});

test('a check --repos file of literally null is refused, not treated as absent', () => {
  // A truthiness guard in the CLI read "the file said null" as "the flag was
  // not passed" and skipped the whole check, so a model could write `null`
  // into its verified file and produce a transcript that looked like it had
  // verified.
  withTempDir(dir => {
    const mapPath = path.join(dir, 'map.json');
    const reposPath = path.join(dir, 'repos.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapWith([note()])));
    fs.writeFileSync(reposPath, 'null');

    const result = spawnSync(process.execPath, [BIN, 'check', mapPath, '--repos', reposPath], {
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--repos: the file must be a JSON object/);
  });
});
