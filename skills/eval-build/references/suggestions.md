# Suggested integrations

A suggestion is SequentDraw's opinion, drawn beside the facts so the user
can judge it in context. It never changes what the map says about the
user's real system: the engine's gap checks ignore suggested nodes
entirely, so a suggestion can neither close a gap nor open one.

## The pool

Read it from the engine every time, never from memory:

```
<sequentdraw> catalogue --json
```

It prints a JSON array of `{ id, name, category, description, icon }`.
Every suggestion's `integration` is one of those `id`s. If nothing in the
list fits an anchor, suggest nothing for it. The list is not ranked, and
nothing else about a product -- what it costs, where it is sold, how
popular it is -- is part of the decision.

## Workflow improvements only

A suggestion says how the user's workflow could run better: fewer hand
steps, a question the map leaves open, a handover that nobody owns. It
never reasons about budget, price, cost, financial fit or region. The user
decides what fits their business. If the user raises money, say that
SequentDraw leaves that call to them and carry on.

## Anchors

A suggestion is admissible only if it attaches to something the map
already shows, in this order of preference:

1. **An open node** -- a question the map leaves open ("Who chases an
   unanswered quote?"). The suggestion goes beside it; the open node
   stays open, because a suggestion does not answer the user's question.
2. **A `manual` step the user does by hand**, where an integration could
   carry the work.
3. **A handover between two systems that a person re-keys.**
4. **A tool the user already named** -- prefer integrations for tools
   already in the map.

"Most businesses use X" is not an anchor. Three hand-scheduled bookings a
day is.

## How many

Aim for three. Go above three only when the map has more distinct anchors,
and never above five suggested nodes in the whole document -- suggestions
already in the map count towards the five. Zero is a correct answer when
nothing in the catalogue fits.

## Writing one

Each suggestion is a node with:

- `id` prefixed `s_` (`s_calendly`)
- `label` the product name from the catalogue, a `sublabel` of at most
  three words for what it would do here, and `kind` usually `service`
- `status: "suggested"` and `source: "model"`
- `integration`: the catalogue `id`
- `rationale`: at most 500 characters, naming the anchor **in the user's
  own words** ("You said you schedule every cleaner by hand after the
  customer confirms")
- `cites`: the ids of the confirmed or open nodes it answers (1 to 10,
  never another suggested node)
- the anchor's `layers` and `parentId`, and `icon` only when the catalogue
  entry has one

and **at least one edge** between it and its anchor (a `dashed` edge with
`source: "model"` reads as "could go here"). An unwired suggestion is an
error.

The engine enforces the shape: a missing `rationale`, `cites` or
`integration`, a cite that is not a real node or is itself suggested, an
integration not in the catalogue, or a sixth suggestion is reported with
the node's path and nothing is written. Fix the node and run the same
command again. What the engine cannot check -- whether the rationale is
true and the cite is the right one -- is yours to get right.

## Accept and decline

Both happen in conversation.

- **Accept** ("yes, use Calendly"): remove `status`, `rationale` and
  `cites` from the node, keep `integration`, set `source: "user"`, keep the
  `s_` id. Its edges stay. Re-check: the node is now part of the real
  system, so the engine may report gaps on it. If an open node sat beside
  it, it stays open -- ask its question again.
- **Decline** ("no, not Xero"): remove the node and every edge touching it,
  and do not suggest it again in this conversation.

Then save, render and republish to the **same** artifact, as the skill's
own steps describe.
