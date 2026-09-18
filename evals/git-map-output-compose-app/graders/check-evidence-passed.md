---
type: regex
target: trace
pattern: 'bin/sequentdraw(?:\\")?\s+check(?=\s)(?:[^"\\]|\\.){0,600}?\s--evidence[\s=](?:[^"\\]|\\.){0,600}?"(?:(?!"type":"tool_use")[\s\S]){0,4000}?(?:\\n|"(?:content|text|stdout)":")(?:ok"|wrote [^\s"\\]+\.json \(\d+ open nodes?)'
match: contains
weight: 1
---

The engine accepted every scan claim in the map. `sequentdraw check … --evidence
<bundle.json>` enforces that each `source: "scan"` node and edge cites real,
connecting evidence, and succeeds in one of two ways: `ok` when it only
checks, or `wrote <file>.json (<n> open nodes)` when it also saves with
`--emit-open`, which writes nothing unless the evidence holds. The skill
does both: the first save is
`printf '%s' '<map>' | node ".../bin/sequentdraw" check - --evidence <bundle> --emit-open <map.json>`,
then `node ".../bin/sequentdraw" check <map.json> --evidence <bundle>`.

The pattern needs, inside one Bash command string, `bin/sequentdraw check`
followed by `--evidence` before the command ends, and then, before the next
`"type":"tool_use"` marker and within 4,000 characters, a tool result line
that starts with one of those two outputs. Captured locally for issue #51,
against `evals/git-map-output-compose-app/fixture/compose-app`:

    $ printf '%s' '<map>' | node ".../bin/sequentdraw" check - --evidence ".../gitmap-run/bundle.json" --emit-open ".../gitmap-run/map.json"
    wrote .../gitmap-run/map.json (0 open nodes)
    $ node ".../bin/sequentdraw" check ".../gitmap-run/map.json" --evidence ".../gitmap-run/bundle.json"
    ok

and in earlier CI traces of this case (runs that passed):

    node /home/runner/work/SequentDraw/SequentDraw/bin/sequentdraw check /tmp/claude-eval-xBAFvf/tmp/map.json --evidence /tmp/claude-eval-xBAFvf/tmp/bundle.json
    ok

A failed check prints `path  message` lines and no `ok` or `wrote`, a
refused command prints a permission message, and a later unrelated `ok`
(for example a plain `check` without `--evidence`) is in a different tool
call, so none of them can match. The skill text writes these commands inside
one long quoted string with no closing quote within 600 characters and never
writes `ok` or `wrote` followed by a closing quote, so reading the skill
cannot satisfy this grader either.
