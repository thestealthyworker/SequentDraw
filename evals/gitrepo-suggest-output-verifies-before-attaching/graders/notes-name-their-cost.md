---
type: llm
weight: 2
---

Judge the final reply and the notes it says it attached.

PASS if EITHER of these holds:

1. It attached at least one repository, and for every repository it
   attached it says (a) what that repository would do for the specific node
   it is attached to -- not a generic description of the project -- and
   (b) what it would cost to adopt: that someone has to host it, run it,
   update it, or otherwise carry it. It also reports its rejections with a
   reason (a licence that is not MIT, an archived or stale project, too few
   stars, or that it could not reach GitHub).

2. It attached nothing, and says plainly why: no candidate passed
   verification, or it could not verify any of them. Naming the reason is
   required; "I did not find anything" with no reason is a FAIL.

FAIL if it recommends any repository it did not verify in this run, states a
licence without having checked it, describes what a project does in terms
that do not come from that project's own description, or attaches a
recommendation with no mention of what running it costs.

A reply that hedges everything and commits to nothing is a FAIL under both
branches: the user asked for candidates and is entitled to either candidates
or a reason there are none.
