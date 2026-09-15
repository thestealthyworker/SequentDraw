---
type: regex
target: trace
pattern: \bok\b
match: contains
weight: 1
---

`sequentdraw check --evidence` prints exactly "ok" and exits 0 once every
scan-sourced node and edge cites real, connecting evidence. This looks for
that literal token in the run's trace (the Bash tool's captured output),
as a signal that the check step was actually run and passed rather than
skipped or left failing.
