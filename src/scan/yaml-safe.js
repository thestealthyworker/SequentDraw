// A bounded YAML parse used by the docker-compose and GitHub Actions
// parsers. `yaml` (pinned exact dependency, see CREDITS.md) is used
// instead of a hand-rolled parser because docker-compose and workflow
// files use enough real YAML (anchors, flow collections, multi-document
// quirks) that a hand-rolled subset parser would either reject valid
// files or silently misread them -- exactly the kind of "confident but
// wrong" evidence this engine must not produce.
//
// What makes this "safe" rather than a bare `YAML.parse`:
//   - a hard cap on input size before parsing even starts, so a huge file
//     already rejected by the safe provider's per-file byte limit can
//     still be short-circuited here defensively
//   - `maxAliasCount` bounds anchor/alias expansion (a "billion laughs"
//     style YAML alias bomb re-references the same anchor exponentially;
//     the `yaml` package counts *expanded* alias uses and throws once the
//     count is exceeded, rather than actually expanding an exponential
//     structure into memory)
//   - custom tags are never resolved as anything other than plain
//     scalars/strings (no `!!js/function`, no schema-specific merge-key
//     surprises beyond YAML's own default schema)
//   - any parse error is caught and treated as "no data", never thrown
//     to the caller -- a hostile or malformed YAML file must degrade to
//     "nothing extracted here", not crash the scan

const YAML = require('yaml');

const MAX_INPUT_BYTES = 2 * 1024 * 1024; // 2MB: generous for compose/workflow files
const MAX_ALIAS_COUNT = 100;

// Parses YAML text and returns the resulting JS value, or null if the
// input is oversized, malformed, or expands past the alias budget.
// Never throws.
function parseYamlSafe(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return null;
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

module.exports = { parseYamlSafe, MAX_INPUT_BYTES, MAX_ALIAS_COUNT };
