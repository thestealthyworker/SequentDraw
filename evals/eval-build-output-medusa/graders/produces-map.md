---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.html \(\d+kb\)'
match: contains
weight: 1
---

The reviewed map was rendered. `sequentdraw render` prints one line when it
writes the map; captured locally for the Medusa map with review notes and a
suggestion:

    wrote rvpf-run/review.html (164kb)

This grader matches that line at the start of a line of tool output. The
skill describes it as `wrote <path> (<size>kb)` with no digits, so the
skill text alone cannot satisfy it.
