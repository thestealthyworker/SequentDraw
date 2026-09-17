# The interview: eight questions

Eight questions, asked in order, tracing **one** unit of value from "work is
needed" to "paid". Each row says what the question asks, what it writes into
the map, and what to write when the user does not know.

"I don't know" and "skip" are the same answer: an `open` node with a
`prompt`. Question 1 is the only one with no fallback, because everything
else hangs off it.

Every node and edge the interview writes carries `source: "user"`. Nodes are
`status: "confirmed"` (the default) unless the row says `open`; an `open`
node also carries a `prompt` of at most 500 characters.

## 1. The unit of value

> "What is the one thing a customer pays you for: a booking, a job, an
> order, a case?"

**Writes:** the map `title` ("How a booking becomes a paid job"), and a
map-level sticky note naming the unit of value and the date of the
interview.

**If the user does not know:** no open node. Offer the user's own words back
as candidates and continue only once one is accepted. A map with no unit of
value has nothing to trace, so say so and stop rather than picking one.

## 2. The trigger

> "How does work arrive? Who asks, and through what: a call, a form,
> WhatsApp, a referral?"

**Writes:** an `external` node for the requester (`layers: ["business"]`), a
`manual` or `service` node for the channel (`["base", "business"]` for a
manual channel, `["base"]` for a system), and a solid edge requester ->
channel.

**If the user does not know:** an open `external` node, label "Who starts
this?", prompt "Work arrives at <channel> but you could not say who sends it
or how it reaches you."

## 3. The first decision

> "Who decides whether to take the work, and on what?"

**Writes:** a `human` or `logic` decider node in `base`, with dashed edges
carrying a `condition` for each outcome the user names ("accepted",
"declined"). An edge with a condition must be `dashed`. If the user says
every request is taken, write no decision node and record that in the note.

**If the user does not know:** an open `logic` node, label "Who decides?",
prompt "Requests are accepted or declined but you could not say who or what
decides, or on what grounds."

## 4. The work

> "Walk me from accepting the work to it being done. What are the steps, and
> who does each one?"

**Writes:** one `manual` or `service` node per step in `base` (a `manual`
step also carries `business`), a `human` node in `business` for each named
doer with an edge doer -> step, and solid edges between the steps in order.
A `sublabel` is at most three words.

**If a step has no named doer:** an open `human` node, label "Who does
this?", prompt "<step> happens but you could not say who performs it."

Where two systems run one after the other, ask how work moves between them
and write the answer as the edge `description`. An undescribed
system-to-system edge is exactly what the `handoff-undrawn` rule asks about.

## 5. The handover

> "What does the customer actually get, and how does it reach them?"

**Writes:** an `artifact` node in `business` for each deliverable (the
report, the signed job card, the parcel), an edge from the last step to it,
and an edge from it to the recipient (`human` or `external`).

**If the user does not know:** an open `external` node, label "Who receives
this?", prompt "<artifact> is produced but no one is named as receiving it."

## 6. Money, or the discharged obligation

> "How do you get paid, and what tells you it is settled: an invoice, a card
> payment, a deposit, a signed acceptance?"

**Writes:** an `artifact` node for the invoice or receipt, the payment
`service` node (or a `manual` "bank transfer" node), and edges through to
the party the money comes from and the person who sees it settle.

**If the user does not know:** an open `artifact` node, label "How is this
paid?", prompt "The work is delivered but you could not say how payment or
sign-off happens, or who confirms it."

## 7. The unhappy paths

> "What goes wrong most often: nobody replies, the work is rejected, the
> customer disputes it. Who handles each?"

**Writes:** one node on the `edge` layer per failure named, reached by a
dashed edge carrying a `condition` from the step it branches off, and a
`human` owner (`layers: ["edge", "business"]`) for each. **Three failures is
the budget** -- ask for the ones that actually happen, not every one
imaginable.

**If a failure has no owner:** an open `human` node in `edge`, label "Who
handles this?", prompt "When <failure> happens, nobody is named as dealing
with it."

**If the user can name no failure at all:** write none, and let the engine
report the empty layer. It answers that with a gold sticky note rather than
a node, which is why `check` on the emitted copy still reports
`unhappy-paths-missing` -- expected, not a failure (see SKILL.md step 4).

## 8. The systems

> "Which of these steps run in software today, and which are done by hand?"

**Writes:** flips `manual` steps to `service`, or the other way round. Add
an `icon` slug **only** when the user names the product; never guess a
brand. Where two steps are both systems, the user's answer to "how does one
reach the other" becomes the edge `description`. If a person carries the
data between them, insert a `manual` node for that person.

**If the user does not know:** nothing is flipped. A `manual` node the user
is unsure about stays `manual`: hand-done is the honest default for a
business flow, and the only one that never claims code exists.

## Where things go

`base` is the always-visible happy path, so **every step in the lifecycle
carries `base`**. The layers this interview adds are `business` (actors,
artifacts, external parties, manual handoffs) and `edge` (failures and their
owners). Edges carry no `layers` of their own -- an edge shows when both its
endpoints do.

| Kind | Layers |
|---|---|
| `manual` step on the happy path | `["base", "business"]` |
| `service` step, `logic` decider | `["base"]` |
| `human`, `external`, `artifact` | `["business"]` |
| a failure node and its owner | `["edge"]`, plus `"business"` for a `human` owner |
