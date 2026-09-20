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
  assert.deepStrictEqual(repoLinksIn('[x](https://github.com/owner/repo)'), ['owner/repo']);
  assert.deepStrictEqual(repoLinksIn('see https://github.com/owner/repo for more'), ['owner/repo']);
  assert.deepStrictEqual(
    repoLinksIn('https://github.com/owner/repo/blob/main/README.md'),
    ['owner/repo'],
  );
  assert.deepStrictEqual(repoLinksIn('https://www.github.com/owner/repo'), ['owner/repo']);
});

test('one repository linked twice in a note counts once', () => {
  const links = repoLinksIn('[a](https://github.com/Owner/Repo) and [b](https://github.com/owner/repo/issues/3)');
  assert.deepStrictEqual(links, ['Owner/Repo']);
});

test('a link that is not a repository is not a repository link', () => {
  // A profile, an organisation page, a search, and github.com itself: a note
  // may reasonably link to any of them without claiming a recommendation.
  assert.deepStrictEqual(repoLinksIn('https://github.com/owner'), []);
  assert.deepStrictEqual(repoLinksIn('https://github.com'), []);
  assert.deepStrictEqual(repoLinksIn('https://github.com/search?q=cron'), []);
  assert.deepStrictEqual(repoLinksIn('https://gitlab.com/owner/repo'), []);
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
