---
type: regex
target: trace
pattern: 'bin/sequentdraw(?:\\")?\s+catalogue'
match: not_contains
weight: 1
---

On "no", the skill skips the suggestion step entirely and does not read the
pool. The pattern matches the Bash call itself, `node ".../bin/sequentdraw"
catalogue --json` (JSON-escaped in the trace as `bin/sequentdraw\"
catalogue`). The skill text only ever writes it as `<sequentdraw> catalogue
--json`, so loading the skill does not trip this grader.

A regex is used rather than `tool_used` with `max: 0`, because the CI job
treats any run error in a case with a `max: 0` grader as fatal, and a
40-turn output case can legitimately stop at its own turn limit.
