---
type: tool_used
tool: Skill
input_match: business-map
min: 1
weight: 1
arm: with-only
---

The business-map skill should fire for a scripted business interview. Skill
evals are single-turn, so an interview cannot be graded as a dialogue: this
prompt supplies the user's side of all eight answers at once, which measures
whether the skill writes what it was told and draws what it was not told --
not whether it asks well. That is checked by hand before each release.
