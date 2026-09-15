---
type: regex
target: last_message
pattern: (\.svg|private artifact|artifact link)
flags: i
match: contains
weight: 1
arm: with-only
---

The final response should mention either a published private artifact or a
local .svg path -- the eval sandbox may not expose the Artifact tool, so
either counts as producing the documented output.
