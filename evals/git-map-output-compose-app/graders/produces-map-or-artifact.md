---
type: regex
target: trace
pattern: wrote [^\s"'\\]+\.html
match: contains
weight: 2
---

The map was actually rendered. `sequentdraw render` prints `wrote <path>.html
(<size>kb)` when it writes the map, and this grader matches that CLI output
in the trace rather than the model's own summary wording, so a claimed but
unperformed render cannot pass and a real render cannot fail on phrasing.
Publishing a private artifact is not required here, because an eval sandbox
may not expose the Artifact tool; the local HTML copy is the dependable
signal.
