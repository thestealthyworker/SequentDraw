---
type: tool_used
tool: Skill
input_match: business-map
min: 1
weight: 1
arm: with-only
---

The business-map skill should fire for a scripted business interview that
also asks for a walkthrough. Skill evals are single-turn, so an interview
cannot be graded as a dialogue: this prompt supplies the user's side of all
eight answers at once, and asks for the tour up front so the skill's
"already asked for one" rule applies and it builds the tour without
pausing to offer it. That measures whether the skill writes what it was
told, draws what it was not told, and turns the request for a walkthrough
into a tour -- not whether it asks or offers well. That is checked by hand
before each release.
