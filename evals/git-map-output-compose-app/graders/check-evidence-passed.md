---
type: regex
target: trace
pattern: check[\s\S]{0,400}?--evidence[\s\S]{0,16000}?\bok\b
match: contains
weight: 1
---

`sequentdraw check - --evidence <bundle.json>` prints exactly "ok" and exits
0 once every scan-sourced node and edge cites real, connecting evidence. The
pattern requires the `check … --evidence` invocation followed, within a
bounded window of the trace, by that "ok" output. The window is wide enough
to span the map document itself, which the skill now pipes in through a
heredoc on the same command (so the whole JSON sits between `--evidence`
and the CLI's reply in the trace), but still bounded, so a stray "ok"
elsewhere in the conversation does not count.
