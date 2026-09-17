---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.svg \(\d+kb\)'
match: contains
weight: 2
---

The SVG was actually rendered. `sequentdraw render … .svg` prints one line
when it writes the figure, and this grader matches that line as it appears at
the start of a line of tool output. Captured in the CI trace of this case's
last passing run (eval run 35214567992):

    wrote /tmp/claude-eval-E4bmtA/tmp/sequentdraw-doc-map/map.svg (2kb)

and locally for issue #51, by path and with a `--merge -` patch:

    wrote .../docmap-run/map.svg (50kb)

The skill describes the line as `wrote <path> (<size>kb)`, behind a backtick
and with no digits, so the skill text alone cannot satisfy this grader.
Publishing a private artifact is not required, because an eval sandbox may
not expose the Artifact tool. Writing inside the repository is prevented
structurally: Write and Edit are not among this case's tools.
