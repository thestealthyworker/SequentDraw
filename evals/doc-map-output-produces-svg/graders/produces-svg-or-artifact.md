---
type: regex
target: last_message
pattern: (\.svg|artifact|wrote |rendered|saved)
flags: i
match: contains
weight: 2
---

The final response should report an .svg output -- either a published
private artifact (an artifact link/mention) or a printed local .svg path,
or at minimum a confirmation of having rendered/saved the file (first
local eval run showed the model does not always literally repeat the
".svg" extension or the word "artifact" in its own summary). An eval
sandbox may not expose the Artifact tool, so any of these count. Nothing
being written inside the repository is enforced structurally (Write and
Edit are not among this case's allowed/granted tools), so no separate
grader checks that.
