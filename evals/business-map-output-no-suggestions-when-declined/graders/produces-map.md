---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 2
---

The map was rendered without suggestions: declining them never costs the
user the map. `sequentdraw render` prints, in the CI trace of the open-nodes
case,

    wrote /tmp/claude-eval-GEkoKS/home/cleaning-map/map.html (73kb)

and this grader matches that line at the start of a line of tool output.
The skill describes it as `wrote <path> (<size>kb)` with no digits, so the
skill text alone cannot satisfy it. Weighted 2 so a run that did nothing
cannot score on the two `not_contains` graders alone.
