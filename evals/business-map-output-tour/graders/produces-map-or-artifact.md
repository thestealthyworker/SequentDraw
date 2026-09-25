---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 2
---

The map was actually rendered, with the tour baked into the same HTML file
(`docs/SPEC.md`, "Output": tours live in the primary HTML output, not a
separate file). `sequentdraw render` prints one line when it writes the
map, and this grader matches that line as it appears at the start of a line
of tool output -- the same pattern the open-nodes case's
`produces-map-or-artifact.md` uses, since a render call prints the same
line whether or not the rendered document carries a tour.

The skill describes the line as `wrote <path> (<size>kb)`, behind a
backtick and with no digits, so the skill text alone cannot satisfy this
grader. Publishing a private artifact is not required, because an eval
sandbox may not expose the Artifact tool; the local HTML copy is the
dependable signal.
