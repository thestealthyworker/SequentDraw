// Reading GitHub repository links back out of a note's markdown.
//
// This module exists on its own because of the bug it was written to fix.
// The first version matched a URL with a regex and then split the string on
// "/". Six shapes slipped through -- `?tab=readme-ov-file`, `#readme`,
// `:443`, `user@`, a backslash separator, and a percent-escaped owner --
// because the extracting regex ACCEPTED characters that the id parser then
// REJECTED, and a link that failed to parse was treated as "not a link"
// rather than as an error. The renderer published every one of them as a
// working <a href>, so a reader could click through to a repository nobody
// had verified. That defeats the only guarantee the whole step provides.
//
// Two rules follow from that, and both matter more than the regex:
//
//   1. **Normalise with `new URL()`, never by splitting a string.** The URL
//      parser resolves a query, a fragment, a port, credentials, a
//      backslash separator, percent escapes and a trailing dot in the host
//      the same way a browser does -- which is the only definition of
//      "where this link actually goes" that counts.
//   2. **Fail closed.** A github.com link with two path segments that are
//      not a legal owner/repo is reported, not ignored. "I could not
//      classify this" must never come out as "there was nothing here".
//
// The extractor must stay a SUPERSET of what src/n8n/markdown.js turns into
// an href. tests/repos-check-repos.test.js pins that as an invariant rather
// than as a list of cases, because two expressions that must agree are
// exactly what produced the original bug.

const { parseRepoId, repoKey } = require('./repo-id');

// Everything github.com is reachable as. `www.` and a trailing dot (the
// fully-qualified form) are the same host to a browser.
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

// A markdown link target: the renderer's own `[text](url)` shape
// (src/n8n/markdown.js INLINE_RE). Its third group is the URL.
const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)]*)\)/g;

// A bare URL in running text. The renderer does NOT auto-link these, so
// scanning for them is deliberately conservative: it can only ever make the
// checker see more than the reader can click, never less.
const BARE_URL_RE = /\bhttps?:\/\/[^\s)\]"'<>]+/gi;

function isGithubHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return GITHUB_HOSTS.has(host);
}

// The two path segments that name a repository, decoded. Returns null when
// the URL is not a github.com link, or names fewer than two segments (a user
// profile, an organisation page, /search -- none of which recommend a
// repository).
function repoPathOf(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isGithubHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  // Percent escapes are decoded here because GitHub decodes them: a link to
  // `/E%2Dorg/R` reaches `E-org/R`. Decoding can throw on a malformed
  // escape, which is itself a link we cannot classify.
  try {
    return [decodeURIComponent(segments[0]), decodeURIComponent(segments[1])];
  } catch {
    return ['', ''];
  }
}

/**
 * Every GitHub repository a note's content links to.
 *
 * Returns { links, unparsable }:
 *   links       distinct `owner/repo` ids, in first-appearance order
 *   unparsable  the raw URLs that point at github.com with two path
 *               segments but do not name a legal repository -- reported by
 *               the caller rather than dropped
 */
function repoLinksIn(content) {
  const links = [];
  const unparsable = [];
  if (typeof content !== 'string') return { links, unparsable };

  const seen = new Set();
  const candidates = [];
  // Markdown targets first, with their spans, so a bare-URL match that is
  // really just the inside of one of those targets is not counted twice.
  // Without this, `[x](https://github.com/owner/re po)` reports both the
  // whole unparsable target AND a truncated `owner/re` read off the same
  // text, which would also double-count toward the three-per-note cap.
  const spans = [];
  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    candidates.push(match[1].trim());
    spans.push([match.index, match.index + match[0].length]);
  }
  for (const match of content.matchAll(BARE_URL_RE)) {
    const inside = spans.some(([from, to]) => match.index >= from && match.index < to);
    if (!inside) candidates.push(match[0]);
  }

  for (const raw of candidates) {
    const parts = repoPathOf(raw);
    if (parts == null) continue;

    const parsed = parseRepoId(`${parts[0]}/${parts[1]}`);
    if (!parsed) {
      if (!unparsable.includes(raw)) unparsable.push(raw);
      continue;
    }
    const key = repoKey(parsed.id);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed.id);
  }

  return { links, unparsable };
}

module.exports = { repoLinksIn, repoPathOf, isGithubHost, GITHUB_HOSTS };
