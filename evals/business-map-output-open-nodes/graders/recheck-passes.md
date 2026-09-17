---
type: regex
target: trace
pattern: 'bin/sequentdraw(?:\\")?\s+check\s+(?:\\")?[^\s"\\]*gaps[^\s"\\]*\.json(?:\\")?(?:\s+2>&1)?"[\s\S]{0,4000}?(?:\\n|"(?:content|text|stdout)":")ok"'
match: contains
weight: 1
---

The emitted copy was re-checked and passed. The pattern requires the actual
Bash call -- `node ".../bin/sequentdraw" check <folder>/gaps.json`, with
nothing after the path, so it is the re-check and not the `--emit-open` call
that wrote the file -- followed within 4,000 characters of trace by a tool
result whose output ends in `ok`. In the CI trace of this case's last passing
run the call and its result are 993 characters apart and read:

    "command":"node \"/home/runner/work/SequentDraw/SequentDraw/bin/sequentdraw\" check /tmp/claude-eval-GEkoKS/home/cleaning-map/gaps.json"
    "content":"/bin/bash: ...: Permission denied\n/bin/bash: ...: Permission denied\nok"

Locally the same command prints exactly:

    ok

The skill's own text writes the command as `<sequentdraw> check
<folder>/gaps.json` and never as `bin/sequentdraw" check`, and never has
`ok` directly after a newline and before a quote, so loading the skill into
the trace cannot satisfy this grader (the previous pattern could).

This prompt names an unhappy path ("about a third of customers never reply
to the quote"), so the map carries an `edge`-layer node and the one rule
that would still report on the copy, `unhappy-paths-missing`, does not
apply.
