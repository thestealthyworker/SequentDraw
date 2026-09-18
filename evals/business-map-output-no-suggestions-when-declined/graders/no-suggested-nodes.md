---
type: regex
target: trace
pattern: '\\"status\\":\s*\\"suggested\\"'
match: not_contains
weight: 1
---

The user said no to recommendations, so no document the run writes may
carry a suggested node. In the trace, a document piped to the CLI through
`printf` carries its quotes escaped, so a suggested node appears as
`\"status\": \"suggested\"` -- the form the suggestions case matches when it
does run. Nothing else that reaches this trace has that form: the skill and
its references write the field as `status: "suggested"` with no quoted key,
and the catalogue output (`[{ "id": "stripe", ... }]` locally) has no
`status` key at all.

`not_contains` passes trivially for a run that did nothing, which is why
this case also requires the map to be rendered.
