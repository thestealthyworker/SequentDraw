---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]*gaps[^\s"\\]*\.json \(\d+ open nodes?(?:, \d+ notes?)?\)'
match: contains
weight: 1
---

The open questions were actually drawn into the map, not merely described in
prose. `sequentdraw check - --emit-open <folder>/gaps.json` prints one line
when it writes the copy; this grader matches that line as it appears in a
tool result. Captured from the CLI (and present verbatim in the CI trace of
this case's last passing run):

    wrote /tmp/claude-eval-GEkoKS/home/cleaning-map/gaps.json (0 open nodes)

and locally, for this prompt's map with its unanswered unhappy path:

    wrote bm-run/gaps.json (1 open node)

The anchor -- a newline or the start of a tool result's text, then `wrote`,
then digits in the count -- is what CLI output has and the skill's own text
does not: the skill describes the line as `wrote <folder>/gaps.json (<n>
open node(s))`, behind a backtick and with no digits, so loading the skill
into the trace can no longer satisfy this grader on its own (the previous
pattern, `check ... --emit-open ... wrote ....json`, matched the skill text).

The pattern deliberately does not require a non-zero count. Two of this
prompt's answers are "I don't know", so gaps exist either way, but a skill
that already wrote them as open nodes during the interview leaves the engine
nothing to add. What is graded is that the emit step ran and wrote the
document the render step then uses.
