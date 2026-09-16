---
type: regex
target: trace
pattern: check[\s\S]{0,400}?--evidence[\s\S]{0,800}?\bok\b
match: contains
weight: 1
---

`sequentdraw check <map.json> --evidence <bundle.json>` prints exactly "ok"
and exits 0 once every scan-sourced node and edge cites real, connecting
evidence. The pattern requires the `check … --evidence` invocation followed,
within a short window of the trace, by that "ok" output. A stray "ok"
elsewhere in the conversation does not count.
