---
type: regex
target: trace
pattern: check [^\s"'\\]*gaps[^\s"'\\]*\.json[\s\S]{0,2000}?\bok\b
match: contains
weight: 1
---

The emitted copy was re-checked and passed. `sequentdraw check gaps.json`
prints exactly "ok" and exits 0 when the copy is complete, which it is by
construction: an open node satisfies the rule that emitted it and is never
itself a subject. The pattern requires the second `check` invocation -- the
one naming the emitted copy, not the `--emit-open` call that wrote it --
followed within a bounded window by that "ok", so a stray "ok" elsewhere in
the conversation does not count.

This prompt names an unhappy path ("about a third of customers never reply
to the quote"), so the map carries an `edge`-layer node and the one rule
that would still report on the copy, `unhappy-paths-missing`, does not
apply. That rule answers "nothing goes wrong in this map" with a map-level
note rather than a node, so its condition stays true of its own copy -- a
map whose author named no failure at all would legitimately still report it,
which is why the skill is told not to loop on `check` waiting for "ok".
