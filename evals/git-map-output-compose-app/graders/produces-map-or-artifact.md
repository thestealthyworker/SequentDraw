---
type: regex
target: last_message
pattern: (\.json|\.html|artifact|wrote |rendered|saved|published)
flags: i
match: contains
weight: 2
---

The final response should report a map output -- either a published
private artifact (an artifact link/mention) or a printed local map.json /
map.html path, or at minimum a confirmation of having rendered/saved the
map (first local eval run timed out at 300s before finishing this step;
timeout_seconds was raised to 600 in response, but that fix is unverified
by a further paid run -- see the eval results in the PR/commit history).
An eval sandbox may not expose the Artifact tool, so any of these count.
