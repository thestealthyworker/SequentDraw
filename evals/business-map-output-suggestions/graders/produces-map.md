---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 1
---

The map was actually rendered. `sequentdraw render` prints one line when it
writes the map; captured locally for this prompt's map with suggestions:

    wrote bm-run/out/map.html (77kb)

and in the CI trace of the open-nodes case:

    wrote /tmp/claude-eval-GEkoKS/home/cleaning-map/map.html (73kb)

The skill describes the line as `wrote <path> (<size>kb)` with no digits,
so the skill text alone cannot satisfy this grader.
