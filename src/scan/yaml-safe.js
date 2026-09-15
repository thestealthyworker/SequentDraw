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

// Parses YAML text and returns the resulting JS value, or null if the
// input is oversized, too deeply nested, malformed, or expands past the
// alias budget. Never throws.
function parseYamlSafe(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return null;
  if (exceedsNestingDepth(text, MAX_NESTING_DEPTH)) return null;
  try {
    return YAML.parse(text, {
      maxAliasCount: MAX_ALIAS_COUNT,
      // Never let a document schema-tag a scalar into something other
      // than string/number/boolean/null; refuse custom tags rather than
      // silently invoking a resolver.
      customTags: [],
    });
  } catch {
    return null;
  }
}

module.exports = { parseYamlSafe, exceedsNestingDepth, MAX_INPUT_BYTES, MAX_ALIAS_COUNT, MAX_NESTING_DEPTH };
