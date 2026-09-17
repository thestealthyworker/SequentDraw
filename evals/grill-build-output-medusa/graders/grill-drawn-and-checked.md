---
type: regex
target: trace
pattern: '\\"(?:status\\":\s*\\"(?:suggested|open)\\"|id\\":\s*\\"n_grill_)[^\n]{0,80000}?bin/sequentdraw(?:\\")?\s+check(?=\s)(?:[^"\\]|\\.){0,600}?\s-(?:\s(?:[^"\\]|\\.){0,600}?)?"(?:(?!"type":"tool_use")[\s\S]){0,4000}?(?:\\n|"(?:content|text|stdout)":")(?:ok"|wrote [^\s"\\]+\.json \(\d+ open nodes?)'
match: contains
weight: 2
---

The grill was drawn into the map and the engine accepted it. On one
trace line (one Bash call), the document piped through `printf` must carry
something the Medusa example does not -- a suggested or open node (the
example has no `status` on any node) or a note whose id starts
`n_grill_`, the prefix grill-build gives its notes -- followed by
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

The skill writes its challenges and alternatives as a patch against the map
file, so the command is `printf '%s' '<patch>' | node ".../bin/sequentdraw"
check examples/medusa-return-flow.json --merge - --emit-open
<folder>/grill.json`. The pattern accepts any `check` command whose own
arguments include a lone `-` (stdin). Captured locally for a patch with one
alternative and two `n_grill_` notes onto the Medusa map:

    wrote merge-run/grill/grill.json (4 open nodes)

An empty patch -- the map sent back unchanged -- prints
`wrote merge-run/neg/unchanged.json (4 open nodes)` but carries no suggested
or open node and no `n_grill_` note, so it cannot match.

A result is only accepted from the same tool call: the window from the
command to its output may not cross a `"type":"tool_use"` marker, so a
failed check followed by some later successful command cannot match.
