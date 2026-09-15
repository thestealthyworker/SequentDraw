// A bounded YAML parse used by the docker-compose and GitHub Actions
// parsers, and by SafeProvider itself for every *.yml/*.yaml file it
// opens (see src/scan/safe-provider.js). `yaml` (pinned exact dependency,
// see CREDITS.md) is used instead of a hand-rolled parser because
// docker-compose and workflow files use enough real YAML (anchors, flow
// collections, multi-document quirks) that a hand-rolled subset parser
// would either reject valid files or silently misread them -- exactly
// the kind of "confident but wrong" evidence this engine must not
// produce.
//
// What makes this "safe" rather than a bare `YAML.parse`:
//   - a hard cap on input size before parsing even starts, so a huge file
//     already rejected by the safe provider's per-file byte limit can
//     still be short-circuited here defensively
//   - a nesting-depth pre-check (see exceedsNestingDepth below) runs
//     BEFORE the text ever reaches YAML.parse. This is deliberately not
//     "parse, then check the result's depth": deep nesting is what makes
//     a recursive-descent YAML parser itself overflow the call stack
//     (GHSA-48c2-rrv3-qjmp, reachable via @specfy/stack-analyser's own
//     compose/GitHub-Actions rules parsing repo-supplied YAML). Pinning
//     `yaml` to 2.9.1 (patched) and npm `overrides` covering
//     stack-analyser's own nested copy close this for an install that
//     respects package-lock.json / overrides; this iterative, entirely
//     non-recursive pre-check is what keeps the guarantee for a
//     downstream install that does not (a different package manager, or
//     one that ignores overrides) -- it can reject the input before
//     calling into the library at all, regardless of which yaml version
//     ends up resolved.
//   - `maxAliasCount` bounds anchor/alias expansion (a "billion laughs"
//     style YAML alias bomb re-references the same anchor exponentially;
//     the `yaml` package counts *expanded* alias uses and throws once the
//     count is exceeded, rather than actually expanding an exponential
//     structure into memory)
//   - custom tags are never resolved as anything other than plain
//     scalars/strings (no `!!js/function`, no schema-specific merge-key
//     surprises beyond YAML's own default schema)
//   - any parse error (including a RangeError from a stack overflow, if
//     one still somehow reaches YAML.parse) is caught and treated as "no
//     data", never thrown to the caller -- a hostile or malformed YAML
//     file must degrade to "nothing extracted here", not crash the scan

const YAML = require('yaml');

const MAX_INPUT_BYTES = 2 * 1024 * 1024; // 2MB: generous for compose/workflow files
const MAX_ALIAS_COUNT = 100;
const MAX_NESTING_DEPTH = 64;

// Fix-round-2 item 1: exceedsNestingDepth() bounds DEPTH but not WIDTH.
// A flat document with tens of thousands of top-level "key: value"
// mappings (or sequence items) passes the depth pre-check in a few
// milliseconds, then makes the underlying parser's own bookkeeping (its
// duplicate-key check, most likely) grow super-quadratically: measured
// 232ms at 4,000 keys, 1,190ms at 8,000, and still running after 120s+
// at 100,000. checkYamlLimits() (below, wrapping countLines() and
// countStructuralEntries()) is the width-side counterpart to
// exceedsNestingDepth(): a single cheap linear scan (never a real
// parse) that rejects anything with more than MAX_LINES lines or more
// than MAX_ENTRIES apparent mapping-entries/sequence-items, BEFORE any
// content ever reaches YAML.parse -- because stack-analyser parses the
// same content with its own options, capping only this module's own
// parse is not enough; the content has to be refused earlier, in
// SafeProvider.open() (see checkYamlLimits below and its use there).
const MAX_LINES = 10000;
const MAX_ENTRIES = 5000;

// Iterative (no recursion of its own, so it cannot itself stack-overflow)
// structural scan for two independent kinds of YAML nesting:
//
//   - flow-collection bracket depth: "[[[[...]]]]" / "{{{{...}}}}",
//     tracked character by character, skipping quoted-string and
//     comment content so a bracket inside a string value is never
//     mistaken for real nesting
//   - block-collection indentation depth: nesting expressed purely by
//     increasing indentation ("a:\n  b:\n    c:\n ..."), tracked as a
//     stack of indentation levels
//
// Returns true as soon as either exceeds `maxDepth`, without finishing
// the scan -- a 10,000-deep bracket bomb returns after ~64 characters,
// not after reading the whole (possibly huge) document.
function exceedsNestingDepth(text, maxDepth) {
  let flowDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && text[i - 1] !== '\\') inDoubleQuote = false;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '#') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '[' || ch === '{') {
      flowDepth++;
      if (flowDepth > maxDepth) return true;
    } else if (ch === ']' || ch === '}') {
      if (flowDepth > 0) flowDepth--;
    }
  }

  const indentStack = [0];
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
      indentStack.pop();
    }
    if (indent > indentStack[indentStack.length - 1]) {
      indentStack.push(indent);
      if (indentStack.length > maxDepth) return true;
    }
  }

  return false;
}

// Counts newlines only -- O(n), one pass, no array allocation (unlike
// text.split(), which exceedsNestingDepth's block-indentation half
// already pays for separately; this is intentionally cheaper since it
// runs first and is meant to short-circuit before anything heavier).
function countLines(text) {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

// A cheap, single-pass, approximate count of "structural entries" --
// block mapping keys, block sequence items, and flow-collection members
// separated by ",". This is deliberately NOT a real parse and does not
// need to be exact: a false positive (counting something that is not
// really a separate entry) only makes this MORE conservative, never
// wrong in the unsafe direction, and the only thing this guards against
// is pathological WIDTH, not correctness of extraction. Returns as soon
// as `maxEntries` is exceeded, without finishing the scan.
//
// Detection per line, checked once at the first non-blank column:
//   - "- " or a bare "-" at end of line: a block sequence item
//   - a ":" followed by a space, newline, or end of input, found before
//     the next newline: a block mapping key. The lookahead for that ":"
//     is bounded by the current line's own length (itself bounded by
//     the MAX_LINES/per-file caps applied before this ever runs), so
//     this stays linear overall despite scanning some characters twice
//     (once here, once in the main loop) -- a constant factor, not a
//     second full pass.
// Plus, independently, every "," seen while inside a flow collection
// ("[...]"/"{...}") counts as one flow-member separator.
function countStructuralEntries(text, maxEntries) {
  let count = 0;
  let flowDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let atLineStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && text[i - 1] !== '\\') inDoubleQuote = false;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      atLineStart = false;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      atLineStart = false;
      continue;
    }
    if (ch === '#') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '\n') {
      atLineStart = true;
      continue;
    }
    if (ch === '[' || ch === '{') {
      flowDepth++;
      atLineStart = false;
      continue;
    }
    if (ch === ']' || ch === '}') {
      if (flowDepth > 0) flowDepth--;
      atLineStart = false;
      continue;
    }

    if (flowDepth > 0) {
      if (ch === ',') {
        count++;
        if (count > maxEntries) return count;
      }
      atLineStart = false;
      continue;
    }

    if (atLineStart && ch !== ' ' && ch !== '\t') {
      atLineStart = false;
      if (ch === '-' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
        count++;
        if (count > maxEntries) return count;
      } else if (ch !== '#') {
        let j = i;
        let sawColon = false;
        while (j < text.length && text[j] !== '\n') {
          if (text[j] === ':' && (j + 1 >= text.length || text[j + 1] === ' ' || text[j + 1] === '\n')) {
            sawColon = true;
            break;
          }
          j++;
        }
        if (sawColon) {
          count++;
          if (count > maxEntries) return count;
        }
      }
    }
  }

  return count;
}

// The safe provider's item-1(a) structural pre-check, run BEFORE any
// real parse: line count, structural width, and nesting depth, each a
// cheap linear scan. Returns { ok: true } or { ok: false, reason }, one
// short machine-readable word per limit so a yaml-rejected finding can
// say which one fired.
function checkYamlLimits(text) {
  if (countLines(text) > MAX_LINES) return { ok: false, reason: 'too-many-lines' };
  if (countStructuralEntries(text, MAX_ENTRIES) > MAX_ENTRIES) return { ok: false, reason: 'too-many-entries' };
  if (exceedsNestingDepth(text, MAX_NESTING_DEPTH)) return { ok: false, reason: 'too-deep' };
  return { ok: true };
}

// The `yaml` package's own maxAliasCount rejection has no distinguishing
// `.code`/`.name` (it surfaces as a plain ReferenceError -- see the
// fix-round-3 investigation), only a stable message text. Matched here,
// once, so every caller gets the same specific 'too-many-aliases' reason
// instead of a generic 'parse-error' -- the message text itself is used
// only to CLASSIFY the failure and is never propagated into a finding.
function isAliasCountError(err) {
  return !!err && typeof err.message === 'string' && err.message.includes('alias count');
}

// The single source of truth for "is this YAML content safe to use, and
// if not, why". Every YAML refusal path in this engine -- the safe
// provider's pre-check, the real parse, a caller that only gets told
// null -- ultimately traces back to this function, so there is exactly
// one place that decides the reason a caller reports.
//
// Returns { ok: true, value } on success, or { ok: false, reason } with
// reason one of: 'file-too-large' | 'too-many-lines' | 'too-many-entries'
// | 'too-deep' | 'too-many-aliases' | 'parse-error'. Never throws.
function classifyYaml(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'parse-error' };
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return { ok: false, reason: 'file-too-large' };

  const limits = checkYamlLimits(text);
  if (!limits.ok) return limits;

  try {
    const value = YAML.parse(text, {
      maxAliasCount: MAX_ALIAS_COUNT,
      // uniqueKeys: false turns off the `yaml` package's own
      // duplicate-key bookkeeping, which is what made a flat, very-wide
      // document (thousands of distinct top-level keys, no duplicates
      // at all) grow super-quadratically instead of linearly --
      // checkYamlLimits() above already enforces a global width cap, so
      // disabling the check trades "reject a document with a real
      // duplicate key" (never a fact this engine needs the library to
      // detect for it) for "parse in linear time".
      uniqueKeys: false,
      // Never let a document schema-tag a scalar into something other
      // than string/number/boolean/null; refuse custom tags rather than
      // silently invoking a resolver.
      customTags: [],
    });
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: isAliasCountError(err) ? 'too-many-aliases' : 'parse-error' };
  }
}

// Parses YAML text and returns the resulting JS value, or null on any
// failure (oversized, too wide/deep, malformed, over the alias budget).
// Never throws. A thin wrapper around classifyYaml() for callers (the
// compose/workflow parsers) that only ever want the parsed value, never
// the reason -- SafeProvider.open() is what actually needs the reason,
// via classifyYaml() directly, to build a yaml-rejected finding.
function parseYamlSafe(text) {
  const result = classifyYaml(text);
  return result.ok ? result.value : null;
}

module.exports = {
  parseYamlSafe,
  classifyYaml,
  exceedsNestingDepth,
  checkYamlLimits,
  countLines,
  countStructuralEntries,
  MAX_INPUT_BYTES,
  MAX_ALIAS_COUNT,
  MAX_NESTING_DEPTH,
  MAX_LINES,
  MAX_ENTRIES,
};
