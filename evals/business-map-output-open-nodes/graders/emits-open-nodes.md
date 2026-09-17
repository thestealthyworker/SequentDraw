---
type: regex
target: trace
pattern: check[\s\S]{0,400}?--emit-open[\s\S]{0,400}?wrote [^\s"'\\]+\.json
match: contains
weight: 1
---

The open questions were actually drawn into the map, not merely described in
prose. `sequentdraw check <map> --emit-open <out.json>` prints
`wrote <path> (<n> open node(s))` when it writes the copy, and this grader
matches that CLI output in the trace rather than the model's own summary
wording, so a claimed but unperformed emit cannot pass.

The pattern deliberately does not require a non-zero count. Two of this
prompt's answers are "I don't know" (who receives the job sheet, who chases
an unanswered quote), so gaps exist either way -- but a skill that already
wrote them as open nodes during the interview, exactly as it is told to, is
doing the right thing and leaves the engine nothing to add. What is being
graded is that the emit step ran and produced the document the render step
then uses.
