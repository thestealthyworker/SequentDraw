---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 2
---

The map was actually rendered. `sequentdraw render` prints one line when it
writes the map, and this grader matches that line as it appears at the start
of a line of tool output. Captured in the CI trace of this case's last
passing run:

    wrote /tmp/claude-eval-GEkoKS/home/cleaning-map/map.html (73kb)

and locally:

    wrote bm-run/out/map.html (77kb)

The skill describes the line as `wrote <path> (<size>kb)`, behind a backtick
and with no digits, so the skill text alone cannot satisfy this grader.
Publishing a private artifact is not required, because an eval sandbox may
not expose the Artifact tool; the local HTML copy is the dependable signal.
