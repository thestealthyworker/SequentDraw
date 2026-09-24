// Verifying a candidate repository: `sequentdraw licences <owner/repo> ...`
// (docs/design/gitrepo-suggest.md sections 2 and 4).
//
// The principle is section 2's: a licence claim is checked, never believed.
// The GitHub licence API is the source -- not the repository's README, not a
// LICENSE file read by hand, and not a model's memory of what a project is
// licensed under. Acting on "this is MIT" when it is AGPL-3.0 has
// consequences for a small business that a wrong icon does not.
//
// This is the first engine code that talks to an API on the user's behalf,
// so the rules are stricter than the scanner's:
//
//   * Two endpoints, one host. The path is built only from an owner/repo
//     that parseRepoId() accepted, never from user text.
//   * Redirects are not followed. A renamed repository is reported, not
//     silently resolved to somewhere else.
//   * The token comes from an environment variable, is sent as a header,
//     and is never logged, never returned, and never written to the output.
//   * Nothing is cloned and nothing is executed; this reads two JSON
//     documents per repository.
//   * Every response is capped, every request has a timeout, and the whole
//     run has a wall-clock cap.
//   * Rate limiting is reported, never retried in a loop.
//
// Verdicts are the output, not errors: the command exits 0 whenever the file
// is written, because "this one is AGPL-3.0" is the answer the caller needs,
// not a failure.

const { parseRepoId } = require('./repo-id');

const API_ORIGIN = 'https://api.github.com';

// The one accepted licence, compared exactly and case-sensitively. Not
// "MIT-0", not "NOASSERTION", not "Other", not a dual licence expressed as
// anything else (docs/design/gitrepo-suggest.md, "The licence rule").
const REQUIRED_SPDX = 'MIT';

const DEFAULT_MAX_REPOS = 15;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_WALL_CLOCK_MS = 120000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

// Activity and fit thresholds. Deliberately crude, and deliberately visible
// here as named constants rather than buried in a comparison, because the
// owner may move them (design section 7, question 1).
const MAX_STALE_MONTHS = 18;
const MIN_STARS = 50;

// The order a repository's failures are reported in when it breaks more than
// one rule. Licence first: it is the rule with legal consequences, and the
// one the caller most needs to hear.
const REASON_ORDER = [
  'licence-unknown',
  'licence-not-mit',
  'archived',
  'stale',
  'is-fork',
  'too-few-stars',
];

const REASON_TEXT = {
  'licence-unknown': 'GitHub reports no licence, or one it cannot identify',
  'licence-not-mit': 'the licence is not MIT',
  archived: 'the repository is archived, so it takes no fixes',
  stale: `nothing has been pushed in ${MAX_STALE_MONTHS} months`,
  'is-fork': 'this is a fork; recommend the upstream instead',
  'too-few-stars': `fewer than ${MIN_STARS} stars`,
  'not-found': 'no such repository, or it is private',
  'auth-failed': 'GitHub rejected the credential; check the token, or unset it and rely on the unauthenticated limit',
  moved: 'the repository has moved; verify its new name instead',
  'rate-limited': 'the GitHub rate limit is exhausted',
  'network-error': 'the request could not be completed',
  'invalid-id': 'not a bare "owner/repo" identifier',
};

function monthsBetween(laterIso, earlierIso) {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return (later - earlier) / (1000 * 60 * 60 * 24 * 30.4375);
}

/**
 * Apply the licence, activity and fit rules to the two API documents.
 * Pure: no clock of its own, no network, no I/O. `nowIso` is the run's
 * single timestamp, so every repository in one file is judged against the
 * same instant.
 *
 * Returns { usable, spdx, reasons } where reasons is in REASON_ORDER.
 */
function classify(repoJson, licenceJson, nowIso) {
  const reasons = [];

  const spdx =
    licenceJson && licenceJson.license && typeof licenceJson.license.spdx_id === 'string'
      ? licenceJson.license.spdx_id
      : null;

  if (spdx == null || spdx === 'NOASSERTION') {
    reasons.push('licence-unknown');
  } else if (spdx !== REQUIRED_SPDX) {
    reasons.push('licence-not-mit');
  }

  if (repoJson.archived === true) reasons.push('archived');

  const months = monthsBetween(nowIso, repoJson.pushed_at);
  if (months == null || months > MAX_STALE_MONTHS) reasons.push('stale');

  if (repoJson.fork === true) reasons.push('is-fork');

  const stars = Number(repoJson.stargazers_count);
  if (!Number.isFinite(stars) || stars < MIN_STARS) reasons.push('too-few-stars');

  reasons.sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));

  return { usable: reasons.length === 0, spdx, reasons };
}

// Read a response body with a hard cap, so an endpoint that answers with a
// gigabyte cannot be made to exhaust this process's memory. The cap is
// checked while reading rather than after, and the stream is cancelled the
// moment it is passed.
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response is larger than ${maxBytes} bytes`);
  }

  // A body may be absent (204, or a stub in a test). There is no stream to
  // cap while reading here, so the size is checked after the fact -- which
  // is why the content-length check above runs first, and why this branch
  // is unreachable with a real body-bearing response from undici.
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error(`response is larger than ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response is larger than ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rateLimitReset(response) {
  const raw = response.headers.get('x-ratelimit-reset');
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

// A primary rate limit answers 403 with no quota remaining. A SECONDARY
// rate limit answers 403 with quota still on the clock and a `retry-after`
// header instead -- it is still a rate limit, and reporting it as "no such
// repository" would send the caller looking for a problem that is not
// there.
function isRateLimited(response) {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  return response.headers.get('retry-after') != null;
}

// One request. Returns { json } on 200, or { status } / { reason } for the
// cases the caller turns into a verdict. Never throws for an HTTP status:
// only for a transport failure, which the caller reports as network-error.
async function getJson(url, { fetchImpl, token, timeoutMs }) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'sequentdraw',
    'x-github-api-version': '2022-11-28',
  };
  // The token is put on the request and nowhere else. It is never part of
  // the URL (which would put it in logs and in any redirect), never part of
  // an error message, and never part of the output file.
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, {
    headers,
    // A redirect is GitHub telling us this is a different repository than
    // the one the caller named. Resolving it silently would verify a
    // licence for a name the caller never typed.
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status >= 300 && response.status < 400) return { reason: 'moved' };
  if (response.status === 404) return { reason: 'not-found' };
  if (isRateLimited(response)) {
    return { reason: 'rate-limited', resetAt: rateLimitReset(response) };
  }
  if (response.status === 401) {
    // The credential itself was rejected: expired, revoked or malformed.
    // Reporting this as "no such repository" would tell the user their ten
    // public MIT repositories do not exist, when the fix is to renew the
    // token or unset it (60 requests an hour unauthenticated covers --max).
    return { reason: 'auth-failed' };
  }
  if (response.status === 403) {
    // A 403 that is neither a primary nor a secondary rate limit: SAML
    // enforcement, an IP allow-list, or a token without the scope. We have
    // no answer about this repository, and it is not the repository's fault.
    return { reason: 'auth-failed' };
  }
  if (!response.ok) {
    return { reason: 'network-error', status: response.status };
  }

  const text = await readCapped(response, MAX_RESPONSE_BYTES);
  return { json: JSON.parse(text) };
}

// The licence endpoint answers 404 for a repository with no recognised
// licence file, which is a verdict ("licence-unknown"), not a missing
// repository. That distinction only holds because the repo endpoint is
// asked first: if THAT is 404, the repository itself is gone.
async function verifyOne(id, options) {
  const parsed = parseRepoId(id);
  if (!parsed) {
    return { id: String(id).slice(0, 120), usable: false, reason: 'invalid-id' };
  }

  const base = `${API_ORIGIN}/repos/${parsed.owner}/${parsed.repo}`;
  const url = `https://github.com/${parsed.owner}/${parsed.repo}`;

  let repoResult;
  try {
    repoResult = await getJson(base, options);
  } catch {
    return { id: parsed.id, url, usable: false, reason: 'network-error' };
  }
  if (repoResult.reason) {
    const out = { id: parsed.id, url, usable: false, reason: repoResult.reason };
    if (repoResult.resetAt) out.resetAt = repoResult.resetAt;
    return out;
  }

  // A 200 carrying `null`, a string or a number is not a repository
  // document. Without this guard classify() dereferences it, the TypeError
  // escapes the whole run, and the verdicts for every repository verified
  // so far are lost with it -- reachable from any intermediary that answers
  // 200 with something that is not the API's response.
  if (!repoResult.json || typeof repoResult.json !== 'object' || Array.isArray(repoResult.json)) {
    return { id: parsed.id, url, usable: false, reason: 'network-error' };
  }

  let licenceJson = null;
  try {
    const licenceResult = await getJson(`${base}/license`, options);
    if (licenceResult.reason === 'rate-limited') {
      const out = { id: parsed.id, url, usable: false, reason: 'rate-limited' };
      if (licenceResult.resetAt) out.resetAt = licenceResult.resetAt;
      return out;
    }
    // 404 here means "no licence GitHub recognises", which classify()
    // turns into licence-unknown. Anything else leaves licenceJson null,
    // which reaches the same verdict -- we did not establish a licence.
    licenceJson = licenceResult.json || null;
  } catch {
    licenceJson = null;
  }

  const { usable, spdx, reasons } = classify(repoResult.json, licenceJson, options.nowIso);

  const entry = {
    id: parsed.id,
    url,
    usable,
    spdx,
    pushedAt: repoResult.json.pushed_at || null,
    stars: Number.isFinite(Number(repoResult.json.stargazers_count))
      ? Number(repoResult.json.stargazers_count)
      : null,
    archived: repoResult.json.archived === true,
    fork: repoResult.json.fork === true,
  };
  if (!usable) {
    entry.reason = reasons[0];
    if (reasons.length > 1) entry.reasons = reasons;
  }
  return entry;
}

/**
 * Verify every candidate. Sequential on purpose: the rate limit is shared,
 * and four requests in flight buy nothing when the whole run is 30 requests
 * against a 60-per-hour unauthenticated budget.
 *
 * Options:
 *   token       the GitHub token, already read from the environment by the
 *               caller (this module never touches process.env, so a test
 *               can prove the token reaches the header and nothing else)
 *   fetchImpl   injected for tests; defaults to global fetch
 *   nowIso      the run's single timestamp
 *   timeoutMs / wallClockMs / max
 */
async function verifyRepos(ids, options = {}) {
  const max = options.max == null ? DEFAULT_MAX_REPOS : options.max;
  if (ids.length > max) {
    throw new Error(`${ids.length} repositories were given; --max is ${max}.`);
  }

  const nowIso = options.nowIso || new Date().toISOString();
  const deadline = Date.now() + (options.wallClockMs || DEFAULT_WALL_CLOCK_MS);
  const requestOptions = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    token: options.token || null,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    nowIso,
  };

  const repos = [];
  const seen = new Set();
  for (const id of ids) {
    const parsed = parseRepoId(id);
    // The same repository named twice is verified once; the caller gets one
    // entry, and the rate-limit budget is not spent twice on one answer.
    const key = parsed ? parsed.id.toLowerCase() : `raw:${String(id)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // The remaining wall clock caps each request too, not just the decision
    // to start one. Gating only the start lets --max 15 repositories with
    // two 10s timeouts each run for 300s against a 120s cap.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      repos.push({
        id: parsed ? parsed.id : String(id).slice(0, 120),
        usable: false,
        reason: 'network-error',
      });
      continue;
    }
    repos.push(
      await verifyOne(id, {
        ...requestOptions,
        timeoutMs: Math.min(requestOptions.timeoutMs, remaining),
      }),
    );
  }

  return { checkedAt: nowIso, repos };
}

module.exports = {
  verifyRepos,
  classify,
  REQUIRED_SPDX,
  REASON_ORDER,
  REASON_TEXT,
  MAX_STALE_MONTHS,
  MIN_STARS,
  DEFAULT_MAX_REPOS,
  MAX_RESPONSE_BYTES,
  API_ORIGIN,
};
