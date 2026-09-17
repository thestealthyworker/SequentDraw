---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 2
---

The map was actually rendered. `sequentdraw render` prints one line when it
writes the map, and this grader matches that line as it appears at the start
of a line of tool output. Captured locally for issue #51 (render by path):

    wrote .../gitmap-run/map.html (49kb)

and in an earlier CI trace of this case:

    wrote /tmp/claude-eval-xBAFvf/tmp/git-map-output/map.html (50kb)

The skill describes the line as `wrote <path> (<size>kb)`, behind a backtick
and with no digits, so the skill text alone cannot satisfy this grader.
Publishing a private artifact is not required, because an eval sandbox may
not expose the Artifact tool; the local HTML copy is the dependable signal.
