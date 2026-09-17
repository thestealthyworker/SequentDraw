---
type: regex
target: trace
pattern: '\\"(?:status\\":\s*\\"(?:suggested|open)\\"|id\\":\s*\\"n_review_)[^\n]{0,80000}?bin/sequentdraw(?:\\")?\s+check(?=\s)(?:[^"\\]|\\.){0,600}?\s-(?:\s(?:[^"\\]|\\.){0,600}?)?"(?:(?!"type":"tool_use")[\s\S]){0,4000}?(?:\\n|"(?:content|text|stdout)":")(?:ok"|wrote [^\s"\\]+\.json \(\d+ open nodes?)'
match: contains
weight: 2
---

The review was drawn into the map and the engine accepted it. On one
trace line (one Bash call), the document piped through `printf` must carry
something the Medusa example does not -- a suggested or open node (the
example has no `status` on any node) or a note whose id starts
`n_review_`, the prefix eval-build gives its notes -- followed by
`node ".../bin/sequentdraw" check -` (optionally `--emit-open <file>`, how
the skill saves it); then, within 4,000 characters, a tool result line that
starts with the CLI's success output. Captured locally, piping the Medusa
map plus two gold notes and one suggested node through `printf`:

    $ printf '%s' '<doc>' | node ".../bin/sequentdraw" check -
    ok
    $ printf '%s' '<doc>' | node ".../bin/sequentdraw" check - --emit-open t1/review.json
    wrote t1/review.json (0 open nodes)

(the Medusa map on its own emits `wrote .../review.json (4 open nodes)`).
Piping the unchanged example cannot match, a failed check prints
`path  message` lines and no `wrote`, and the skill text never writes a
quoted `"status"` or `"id"` key, so it cannot supply the match.

The skill writes its findings as a patch against the map file, so the command
is `printf '%s' '<patch>' | node ".../bin/sequentdraw" check
examples/medusa-return-flow.json --merge - --emit-open <folder>/review.json`.
The pattern accepts any `check` command whose own arguments include a lone
`-` (stdin). Captured locally for a patch with one suggestion and one
`n_review_` note onto the Medusa map (the map's own four gaps are drawn as
open nodes by the same command):

    wrote merge-run/review/review.json (4 open nodes)

An empty patch -- the map sent back unchanged -- prints the same kind of line
(`wrote merge-run/neg/unchanged.json (4 open nodes)`) but its command carries
no suggested or open node and no `n_review_` note, so it cannot match.

A result is only accepted from the same tool call: the window from the
command to its output may not cross a `"type":"tool_use"` marker, so a
failed check followed by some later successful command cannot match.
