---
type: llm
weight: 1
---

Judge the assistant's final reply, which summarises a balanced review of
the Medusa order-return map.

PASS when all of these hold:
- At least one finding names a specific component of the map (for example
  the payment provider, the event bus, the inspection step, a return edge
  case) rather than speaking about "the system" in general.
- Every integration it says it suggested is tied to a named part of the map
  or a named gap in it, not justified by popularity ("widely used", "most
  teams use").
- It says something about what already works, not only what is wrong.

FAIL when any of those does not hold, or when the reply contains no review
at all (for example it only reports an error).
