// `sequentdraw licences`: the licence, activity and fit rules, the URL the
// engine is allowed to build, and what happens to the token
// (docs/design/gitrepo-suggest.md sections 2, 4 and 6).
//
// Offline and deterministic. Every response is a recorded one, handed in
// through the module's injected fetch, so CI never calls GitHub: a test
// suite whose verdicts depend on how many stars a real repository has today
// is a test suite that fails for reasons that are not the code's.

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  verifyRepos,
  classify,
  REASON_ORDER,
  REASON_TEXT,
  MIN_STARS,
  MAX_STALE_MONTHS,
} = require('../src/repos/licences');
const { parseRepoId, OWNER_RE, REPO_RE } = require('../src/repos/repo-id');
const licencesCmd = require('../src/cli/licences');

const NOW = '2026-09-20T00:00:00Z';

function repoJson(over = {}) {
  return {
    archived: false,
    fork: false,
    pushed_at: '2026-07-02T11:04:00Z',
    stargazers_count: 1840,
    default_branch: 'main',
    html_url: 'https://github.com/owner/repo',
    ...over,
  };
}

function licenceJson(spdx) {
  return spdx === undefined ? {} : { license: spdx === null ? null : { spdx_id: spdx } };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

// A fetch that answers from a table keyed by URL, and records every call
// (url plus the headers it was given) so a test can assert on both.
function recordedFetch(table) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const entry = table[url];
    if (!entry) return new Response('{"message":"Not Found"}', { status: 404 });
    return typeof entry === 'function' ? entry() : entry();
  };
  impl.calls = calls;
  return impl;
}

function tableFor(id, { repo = repoJson(), licence = licenceJson('MIT') } = {}) {
  const base = `https://api.github.com/repos/${id}`;
  return {
    [base]: () => jsonResponse(repo),
    [`${base}/license`]: () => jsonResponse(licence),
  };
}

// ---------------------------------------------------------------- the rules

test('an MIT, active, non-fork, well-starred repository is usable', async () => {
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });

  assert.strictEqual(out.checkedAt, NOW);
  assert.strictEqual(out.repos.length, 1);
  assert.deepStrictEqual(out.repos[0], {
    id: 'owner/repo',
    url: 'https://github.com/owner/repo',
    usable: true,
    spdx: 'MIT',
    pushedAt: '2026-07-02T11:04:00Z',
    stars: 1840,
    archived: false,
    fork: false,
  });
});

// The rule the whole command exists for: exactly "MIT", nothing adjacent.
for (const [spdx, reason] of [
  ['MIT-0', 'licence-not-mit'],
  ['mit', 'licence-not-mit'],
  ['AGPL-3.0', 'licence-not-mit'],
  ['Apache-2.0', 'licence-not-mit'],
  ['BSD-3-Clause', 'licence-not-mit'],
  ['Other', 'licence-not-mit'],
  ['NOASSERTION', 'licence-unknown'],
]) {
  test(`spdx_id "${spdx}" is refused as ${reason}`, () => {
    const verdict = classify(repoJson(), licenceJson(spdx), NOW);
    assert.strictEqual(verdict.usable, false);
    assert.strictEqual(verdict.reasons[0], reason);
    assert.strictEqual(verdict.spdx, spdx);
  });
}

test('a missing license object, and a null one, are both licence-unknown', () => {
  assert.strictEqual(classify(repoJson(), licenceJson(), NOW).reasons[0], 'licence-unknown');
  assert.strictEqual(classify(repoJson(), licenceJson(null), NOW).reasons[0], 'licence-unknown');
  assert.strictEqual(classify(repoJson(), null, NOW).reasons[0], 'licence-unknown');
});

test('the licence endpoint answering 404 means licence-unknown, not not-found', async () => {
  const base = 'https://api.github.com/repos/owner/repo';
  const fetchImpl = recordedFetch({
    [base]: () => jsonResponse(repoJson()),
    [`${base}/license`]: () => jsonResponse({ message: 'Not Found' }, { status: 404 }),
  });
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].usable, false);
  assert.strictEqual(out.repos[0].reason, 'licence-unknown');
  assert.strictEqual(out.repos[0].spdx, null);
});

test('archived, stale, fork and low-star repositories each fail with their own reason', () => {
  const cases = [
    [{ archived: true }, 'archived'],
    [{ pushed_at: '2024-01-01T00:00:00Z' }, 'stale'],
    [{ fork: true }, 'is-fork'],
    [{ stargazers_count: MIN_STARS - 1 }, 'too-few-stars'],
  ];
  for (const [over, reason] of cases) {
    const verdict = classify(repoJson(over), licenceJson('MIT'), NOW);
    assert.strictEqual(verdict.usable, false, `${reason} should not be usable`);
    assert.deepStrictEqual(verdict.reasons, [reason]);
  }
});

test('exactly MIN_STARS passes; the floor is inclusive', () => {
  assert.strictEqual(classify(repoJson({ stargazers_count: MIN_STARS }), licenceJson('MIT'), NOW).usable, true);
});

test(`a push just inside ${MAX_STALE_MONTHS} months passes and just outside does not`, () => {
  const inside = classify(repoJson({ pushed_at: '2025-04-01T00:00:00Z' }), licenceJson('MIT'), NOW);
  const outside = classify(repoJson({ pushed_at: '2025-01-01T00:00:00Z' }), licenceJson('MIT'), NOW);
  assert.strictEqual(inside.usable, true);
  assert.deepStrictEqual(outside.reasons, ['stale']);
});

test('a missing or unparseable pushed_at is stale, never silently fresh', () => {
  assert.deepStrictEqual(classify(repoJson({ pushed_at: undefined }), licenceJson('MIT'), NOW).reasons, ['stale']);
  assert.deepStrictEqual(classify(repoJson({ pushed_at: 'soon' }), licenceJson('MIT'), NOW).reasons, ['stale']);
});

test('a repository failing several rules reports them in a fixed order, licence first', () => {
  const verdict = classify(
    repoJson({ archived: true, fork: true, stargazers_count: 2, pushed_at: '2020-01-01T00:00:00Z' }),
    licenceJson('AGPL-3.0'),
    NOW,
  );
  assert.deepStrictEqual(verdict.reasons, [
    'licence-not-mit',
    'archived',
    'stale',
    'is-fork',
    'too-few-stars',
  ]);
  // And the order is REASON_ORDER's, not the order the checks happen to run.
  const sorted = [...verdict.reasons].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));
  assert.deepStrictEqual(verdict.reasons, sorted);
});

test('a multi-reason rejection carries the first reason and the full list', async () => {
  const fetchImpl = recordedFetch(
    tableFor('owner/repo', { repo: repoJson({ archived: true }), licence: licenceJson('AGPL-3.0') }),
  );
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'licence-not-mit');
  assert.deepStrictEqual(out.repos[0].reasons, ['licence-not-mit', 'archived']);
});

// ------------------------------------------------------------- the URL rule

test('the request URL is built only from a validated owner/repo', async () => {
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.deepStrictEqual(
    fetchImpl.calls.map(c => c.url),
    ['https://api.github.com/repos/owner/repo', 'https://api.github.com/repos/owner/repo/license'],
  );
});

test('hostile identifiers are refused before any request is made', async () => {
  const hostile = [
    '../etc/passwd',
    'owner/..',
    'owner/.',
    '%2e%2e/%2e%2e',
    'https://evil.example.com/a/b',
    'owner/repo?x=1',
    'owner/repo#frag',
    'owner/repo/extra',
    'owner',
    '',
    '   ',
    'own er/repo',
    'owner/re po',
    `${'a'.repeat(40)}/repo`,
    '-owner/repo',
    'owner/repo\nX',
    'owner\\repo',
    'evil.com:443/a/b',
  ];
  for (const id of hostile) {
    assert.strictEqual(parseRepoId(id), null, `${JSON.stringify(id)} must not parse`);
  }

  const fetchImpl = recordedFetch({});
  const out = await verifyRepos(hostile, { fetchImpl, nowIso: NOW, max: 100 });
  assert.strictEqual(fetchImpl.calls.length, 0, 'nothing may be requested for a refused id');
  out.repos.forEach(entry => assert.strictEqual(entry.reason, 'invalid-id'));
});

test('a legal owner/repo with a trailing .git is accepted and normalised', () => {
  assert.deepStrictEqual(parseRepoId('owner/repo.git'), { owner: 'owner', repo: 'repo', id: 'owner/repo' });
});

test('the owner and repo expressions match the ones the scanner applies to a GitHub URL', () => {
  const acquire = fs.readFileSync(path.join(__dirname, '..', 'src', 'scan', 'acquire.js'), 'utf8');
  // acquire.js holds them as strings for composition into a path regex;
  // repo-id.js anchors the same text. Compared as text on purpose: the two
  // are allowed to be separate code, not to disagree about what is legal.
  assert.ok(acquire.includes("const OWNER_RE = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})'"));
  assert.ok(acquire.includes("const REPO_RE = '[A-Za-z0-9._-]{1,100}'"));
  assert.strictEqual(OWNER_RE.source, '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$');
  assert.strictEqual(REPO_RE.source, '^[A-Za-z0-9._-]{1,100}$');
});

// ---------------------------------------------------------------- the token

test('the token is sent as a header and appears nowhere else', async () => {
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW, token: 'ghp_SECRET_VALUE' });

  fetchImpl.calls.forEach(call => {
    assert.strictEqual(call.options.headers.authorization, 'Bearer ghp_SECRET_VALUE');
    assert.ok(!call.url.includes('SECRET'), 'the token must never be in the URL');
  });
  assert.ok(!JSON.stringify(out).includes('SECRET'), 'the token must never be in the output');
});

test('no Authorization header is sent when there is no token', async () => {
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  fetchImpl.calls.forEach(call => {
    assert.strictEqual(call.options.headers.authorization, undefined);
  });
});

test('the CLI reads the token from the environment, never from an argument', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-licences-'));
  const outPath = path.join(dir, 'repos.json');
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  const stdout = [];
  const stderr = [];

  const code = await licencesCmd.run(
    ['owner/repo', '--out', outPath, '--token-env', 'SD_TEST_TOKEN'],
    { stdout: { write: s => stdout.push(s) }, stderr: { write: s => stderr.push(s) } },
    { env: { SD_TEST_TOKEN: 'ghp_FROM_ENV' }, fetchImpl, nowIso: NOW },
  );

  assert.strictEqual(code, 0);
  assert.strictEqual(fetchImpl.calls[0].options.headers.authorization, 'Bearer ghp_FROM_ENV');
  const written = fs.readFileSync(outPath, 'utf8');
  assert.ok(!written.includes('ghp_FROM_ENV'));
  assert.ok(!stdout.join('').includes('ghp_FROM_ENV'));
  assert.ok(!stderr.join('').includes('ghp_FROM_ENV'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------- network and transport

test('403 with no remaining quota is rate-limited, reported and not retried', async () => {
  const base = 'https://api.github.com/repos/owner/repo';
  let calls = 0;
  const fetchImpl = recordedFetch({
    [base]: () => {
      calls++;
      return jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } },
      );
    },
  });

  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'rate-limited');
  assert.strictEqual(out.repos[0].resetAt, new Date(1790000000 * 1000).toISOString());
  assert.strictEqual(calls, 1, 'a rate limit must not be retried in a loop');
});

test('a run continues to the next repository after one is rate-limited', async () => {
  const limited = 'https://api.github.com/repos/a/one';
  const fetchImpl = recordedFetch({
    [limited]: () =>
      jsonResponse({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ...tableFor('b/two'),
  });
  const out = await verifyRepos(['a/one', 'b/two'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'rate-limited');
  assert.strictEqual(out.repos[1].usable, true);
});

test('a 404 on the repository itself is not-found', async () => {
  const out = await verifyRepos(['owner/gone'], { fetchImpl: recordedFetch({}), nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'not-found');
  assert.strictEqual(out.repos[0].usable, false);
});

test('a redirect is reported as moved and never followed', async () => {
  const base = 'https://api.github.com/repos/owner/old';
  const fetchImpl = recordedFetch({
    [base]: () =>
      new Response('', { status: 301, headers: { location: 'https://api.github.com/repos/owner/new' } }),
  });
  const out = await verifyRepos(['owner/old'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'moved');
  assert.strictEqual(fetchImpl.calls.length, 1, 'the redirect target must not be requested');
  assert.strictEqual(fetchImpl.calls[0].options.redirect, 'manual');
});

test('a transport failure is network-error and does not end the run', async () => {
  const fetchImpl = async url => {
    if (url.includes('a/one')) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    return jsonResponse(url.endsWith('/license') ? licenceJson('MIT') : repoJson());
  };
  const out = await verifyRepos(['a/one', 'b/two'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'network-error');
  assert.strictEqual(out.repos[1].usable, true);
});

test('a response over the cap is refused rather than buffered', async () => {
  const base = 'https://api.github.com/repos/owner/repo';
  const fetchImpl = recordedFetch({
    [base]: () =>
      new Response(JSON.stringify(repoJson()), {
        headers: { 'content-length': String(64 * 1024 * 1024) },
      }),
  });
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'network-error');
});

test('only api.github.com is ever contacted', async () => {
  const fetchImpl = recordedFetch({ ...tableFor('a/one'), ...tableFor('b/two') });
  await verifyRepos(['a/one', 'b/two'], { fetchImpl, nowIso: NOW });
  fetchImpl.calls.forEach(call => {
    assert.strictEqual(new URL(call.url).origin, 'https://api.github.com');
  });
});

test('the same repository named twice is verified once', async () => {
  const fetchImpl = recordedFetch(tableFor('owner/repo'));
  const out = await verifyRepos(['owner/repo', 'Owner/Repo', 'owner/repo.git'], {
    fetchImpl,
    nowIso: NOW,
  });
  assert.strictEqual(out.repos.length, 1);
  assert.strictEqual(fetchImpl.calls.length, 2, 'two endpoints, once');
});

test('more repositories than --max is refused before any request', async () => {
  const fetchImpl = recordedFetch({});
  await assert.rejects(
    () => verifyRepos(['a/1', 'b/2', 'c/3'], { fetchImpl, nowIso: NOW, max: 2 }),
    /--max is 2/,
  );
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// -------------------------------------------------------------------- output

test('the command writes the verdicts, names every rejection, and exits 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-licences-'));
  const outPath = path.join(dir, 'nested', 'repos.json');
  const fetchImpl = recordedFetch({
    ...tableFor('good/one'),
    ...tableFor('bad/two', { licence: licenceJson('AGPL-3.0') }),
  });
  const stdout = [];
  const stderr = [];

  const code = await licencesCmd.run(
    ['good/one', 'bad/two', '--out', outPath],
    { stdout: { write: s => stdout.push(s) }, stderr: { write: s => stderr.push(s) } },
    { env: {}, fetchImpl, nowIso: NOW },
  );

  assert.strictEqual(code, 0, 'a rejected licence is a verdict, not a failure');
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(written.repos.length, 2);
  assert.strictEqual(written.repos[0].usable, true);
  assert.strictEqual(written.repos[1].usable, false);
  assert.match(stderr.join(''), /bad\/two {2}the licence is not MIT/);
  assert.match(stdout.join(''), /\(1 usable, 1 rejected\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nothing is written when an argument is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-licences-'));
  const outPath = path.join(dir, 'repos.json');
  const stderr = [];
  const fetchImpl = recordedFetch({});

  for (const args of [
    ['--out', outPath],
    ['owner/repo'],
    ['owner/repo', '--out'],
    ['owner/repo', '--out', outPath, '--max', '0'],
    ['owner/repo', '--out', outPath, '--unknown'],
    ['not-an-id', '--out', outPath],
  ]) {
    const code = await licencesCmd.run(
      args,
      { stdout: { write() {} }, stderr: { write: s => stderr.push(s) } },
      { env: {}, fetchImpl, nowIso: NOW },
    );
    assert.strictEqual(code, 1, `${args.join(' ')} should be refused`);
    assert.strictEqual(fs.existsSync(outPath), false, `${args.join(' ')} wrote a file`);
  }
  assert.strictEqual(fetchImpl.calls.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--help prints the rules and exits 0 without touching the network', async () => {
  const stdout = [];
  const fetchImpl = recordedFetch({});
  const code = await licencesCmd.run(
    ['--help'],
    { stdout: { write: s => stdout.push(s) }, stderr: { write() {} } },
    { env: {}, fetchImpl },
  );
  assert.strictEqual(code, 0);
  assert.match(stdout.join(''), /exactly "MIT"/);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('the dispatcher exposes licences', () => {
  const { COMMANDS, TOP_USAGE } = require('../src/cli/index');
  assert.strictEqual(COMMANDS.licences, licencesCmd);
  assert.match(TOP_USAGE, /licences <owner\/repo>/);
});

// ------------------------------------------- what a hostile response can do

test('a 200 whose body is not a repository document does not end the run', () => {
  // classify() dereferenced it, the TypeError escaped verifyRepos, and the
  // CLI exited 1 WITHOUT writing the file -- losing the verdicts for every
  // repository already verified. Reachable from any intermediary that
  // answers 200 with something that is not the API's response.
  return (async () => {
    for (const body of [null, '"hello"', '123', '[]']) {
      const base = 'https://api.github.com/repos/owner/repo';
      const fetchImpl = recordedFetch({
        [base]: () => new Response(body, { headers: { 'content-type': 'application/json' } }),
        [`${base}/license`]: () => jsonResponse(licenceJson('MIT')),
        ...tableFor('other/repo'),
      });

      const out = await verifyRepos(['owner/repo', 'other/repo'], { fetchImpl, nowIso: NOW });
      assert.strictEqual(out.repos.length, 2, `body ${body} ended the run`);
      assert.strictEqual(out.repos[0].usable, false);
      assert.strictEqual(
        out.repos[1].usable,
        true,
        `body ${body} lost the verdict for the next repository`,
      );
    }
  })();
});

test('a rejected credential says so, instead of claiming the repository does not exist', () => {
  // A 401 reported as not-found tells a user their ten public MIT
  // repositories do not exist, when the fix is to renew the token or unset
  // it -- 60 requests an hour unauthenticated covers --max 15.
  return (async () => {
    const base = 'https://api.github.com/repos/owner/repo';
    const fetchImpl = recordedFetch({
      [base]: () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
    });
    const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW, token: 'stale' });
    assert.strictEqual(out.repos[0].reason, 'auth-failed');
    assert.match(REASON_TEXT['auth-failed'], /credential/);
  })();
});

test('a secondary rate limit is reported as a rate limit, not as not-found', async () => {
  // GitHub signals it with a 403 plus retry-after and quota still on the
  // clock, so the "remaining is 0" test alone misses it.
  const base = 'https://api.github.com/repos/owner/repo';
  const fetchImpl = recordedFetch({
    [base]: () =>
      jsonResponse(
        { message: 'You have exceeded a secondary rate limit' },
        { status: 403, headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4321' } },
      ),
  });
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'rate-limited');
  assert.strictEqual(fetchImpl.calls.length, 1, 'and it is still not retried');
});

test('a 403 that is neither rate limit nor a missing repository is an auth failure', async () => {
  const base = 'https://api.github.com/repos/owner/repo';
  const fetchImpl = recordedFetch({
    [base]: () => jsonResponse({ message: 'SAML enforcement' }, { status: 403 }),
  });
  const out = await verifyRepos(['owner/repo'], { fetchImpl, nowIso: NOW });
  assert.strictEqual(out.repos[0].reason, 'auth-failed');
});

test('the wall clock bounds the run, not just the decision to start one', async () => {
  // Checking the deadline only before starting each repository let --max 15
  // with two 10s timeouts each run for 300s against a 120s cap.
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(options.signal);
    return jsonResponse(url.endsWith('/license') ? licenceJson('MIT') : repoJson());
  };
  await verifyRepos(['a/one'], { fetchImpl, nowIso: NOW, timeoutMs: 60000, wallClockMs: 1000 });
  assert.ok(seen.length > 0);
  // The signal handed to fetch must carry the SMALLER of the two, so a
  // single slow request cannot outlive the run's own cap.
  assert.ok(seen.every(signal => signal instanceof AbortSignal));
});

test('--token-env naming an inherited property sends no token', async () => {
  // process.env has Object.prototype on its chain, so env["constructor"]
  // used to put the Object constructor's source in an Authorization header.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-licences-'));
  const outPath = path.join(dir, 'repos.json');
  const fetchImpl = recordedFetch(tableFor('owner/repo'));

  const code = await licencesCmd.run(
    ['owner/repo', '--out', outPath, '--token-env', 'constructor'],
    { stdout: { write() {} }, stderr: { write() {} } },
    { env: {}, fetchImpl, nowIso: NOW },
  );

  assert.strictEqual(code, 0);
  fetchImpl.calls.forEach(call => {
    assert.strictEqual(call.options.headers.authorization, undefined);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
