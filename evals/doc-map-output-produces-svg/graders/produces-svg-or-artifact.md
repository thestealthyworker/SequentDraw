---
type: regex
target: trace
pattern: wrote [^\s"'\\]+\.svg
match: contains
weight: 2
---

The SVG was actually rendered. `sequentdraw render … .svg` prints `wrote
<path>.svg (<size>kb)` when it writes the figure, and this grader matches
that CLI output in the trace rather than the model's own summary wording, so
a claimed but unperformed export cannot pass and a real export cannot fail
on phrasing. Publishing a private artifact is not required, because an eval
sandbox may not expose the Artifact tool. Writing inside the repository is
prevented structurally: Write and Edit are not among this case's tools.
