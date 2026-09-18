---
type: regex
target: trace
pattern: '\\"status\\":\s*\\"suggested\\"[^\n]{0,80000}?bin/sequentdraw(?:\\")?\s+check(?=\s)(?:[^"\\]|\\.){0,600}?\s-(?:\s(?:[^"\\]|\\.){0,600}?)?"(?:(?!"type":"tool_use")[\s\S]){0,4000}?(?:\\n|"(?:content|text|stdout)":")(?:ok"|wrote [^\s"\\]+\.json \(\d+ open nodes?)'
match: contains
weight: 2
---

A document carrying at least one suggested node passed the engine. The
engine enforces the suggestion contract -- `rationale`, `cites` that name
real, non-suggested nodes, an `integration` from the catalogue, at most five
-- so passing `check` is the deterministic proof the suggestions are
well-formed.

The pattern requires, on one trace line (one Bash call), a suggested node in
the document piped through `printf` followed by
`node ".../bin/sequentdraw" check -` (optionally `--emit-open <file>`, which
is how the skill saves it), and then, within 4,000 characters, a tool result
line that starts with the CLI's success output. Captured locally for a
cleaning map with three suggestions, piped through `printf`:

    $ printf '%s' '<doc>' | node ".../bin/sequentdraw" check -
    ok
    $ printf '%s' '<doc>' | node ".../bin/sequentdraw" check - --emit-open pf-run/deep/gaps2.json
    wrote pf-run/deep/gaps2.json (0 open nodes)

A failed check cannot match: it prints `path  message` lines such as

    /nodes/17/integration  Node "s_xero" integration "freshbooks" is not in the SequentDraw catalogue.

and exits 1 without a `wrote` line. The skill text never writes a quoted
`"status"` key, so it cannot supply the first half of the match.

The skill now writes suggestions as a patch against the saved gaps.json, so
the command is `printf '%s' '<patch>' | node ".../bin/sequentdraw" check
<folder>/gaps.json --merge - --emit-open <folder>/suggested.json`. The pattern
accepts any `check` command whose own arguments include a lone `-` (stdin):
`check -` for a whole document, or `check <map> --merge -` for a patch.
Captured locally for a two-suggestion patch onto the cleaning map's gaps.json:

    wrote merge-run/bm/suggested.json (0 open nodes)

A result is only accepted from the same tool call: the window from the
command to its output may not cross a `"type":"tool_use"` marker, so a
failed check followed by some later successful command cannot match.
