---
type: llm
weight: 1
---

Judge the assistant's final reply, which summarises a harsh critique of the
Medusa order-return map.

PASS when all of these hold:
- Every challenge names a specific component of the map (for example
  Postgres, the event bus, the payment provider, a manual inspection step)
  and a concrete failure or weakness of it; none is a generic claim such as
  "this won't scale" with no component named.
- Each stronger alternative it proposes names what it would replace and
  states a trade-off: what it improves and what it gives up or makes
  harder (in operational, lock-in or reliability terms).
- The critique is direct and unsparing -- it leads with weaknesses rather
  than praise -- without insults or shouting.

FAIL when any of those does not hold, or when the reply contains no critique
at all (for example it only reports an error).
