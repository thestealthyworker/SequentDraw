# Design: correction mode in the viewer (build step 7a)

Written 2026-09-19, after the M2 gate. Implements `docs/HANDOVER.md` step 7a.

The owner added this step on 2026-09-15, after reviewing real maps: a map is wrong in
small, specific ways, and the person who can see it is the person looking at it. Today
they must go back to the conversation and describe the fix in words. Correction mode
lets them make it where they see it.

## Decision

The interactive viewer gains a **Correct** mode. In it, the reader fixes what the map
says — not where it sits — and saves a corrected document plus a change list. The
engine re-renders that document with a fresh layout.

Six operations, no more (the full list and its limits are below):

| # | Operation | What it changes in the document |
|---|---|---|
| 1 | Reattach a connection | `edge.from` or `edge.to` |
| 2 | Delete a connection | removes the edge |
| 3 | Move a node to another group | `node.parentId` |
| 4 | Change which layers a node is on | `node.layers` |
| 5 | Change a node's kind | `node.kind` (and clears a now-wrong `icon`) |
| 6 | Edit, add or delete a sticky note | `notes[]` |

Plus two that already have defined semantics in `docs/SPEC.md` and are the viewer's
counterpart to the step 7 suggestion flow:

| # | Operation | What it changes in the document |
|---|---|---|
| 7 | Accept a suggested node | drops `status`, `rationale`, `cites`; keeps `integration`; sets `source: "user"` |
| 8 | Decline a suggested node, or delete a wrongly mapped node | removes the node and every edge touching it |

## Principle: correct by meaning, never by position

There is no dragging, and nothing in correction mode writes a coordinate. This is not
a simplification, it is the spec's root rule (`docs/SPEC.md`, "Positions are never
stored"): stored positions would break computed layout, layer toggles and the
documentation export, and the same document would stop rendering the same way on two
machines.

So a correction says *Stripe belongs in Payment*, not *Stripe belongs at x=1180*. The
new layout is computed by the engine on re-render, and the reader sees it in the next
file. The viewer never re-lays-out anything.

Two consequences the interface must be honest about:

- **A pending correction is not previewed as geometry.** Changing a kind is previewed
  (the ring and glyph change in place; the box size does not). Moving a group, changing
  layers, reattaching or deleting a connection are shown as a badge on the affected
  element and a line in the change list, not as a moved node or a redrawn line. A fake
  preview would be a lie about the layout the user is going to get.
- **Correction mode is a document editor with a map in front of it.** The reward for
  saving is a new render, and the panel prints the exact command that produces it.

Conversational correction is unaffected and stays the faster path for anything textual:
every skill from `git-map` on already accepts "Stripe belongs in Payment" and applies it
as a `--merge` patch. Correction mode is for the person holding the HTML file, possibly
without the conversation that produced it.

## What the viewer has to carry

The HTML embeds the card data, not the document: `buildCardData()` drops `icon`,
`source`, `cites`, `integration`, group ids, note bodies and the title. A corrected
document cannot be reconstructed from it.

**The renderer therefore embeds the validated source document** as one more JSON
literal (`SOURCE_DOC`), alongside `CANVAS`, `GEOMETRY` and `CARD_DATA`, escaped by the
same `safeJson()` and parsed back in the single viewer script.

Cost, measured on `examples/medusa-return-flow.json` (40 nodes, 44 edges, 4 layers):
document 23kb against a 149kb render, so **+15%**. Accepted: it makes the HTML file
self-contained in the sense that matters — a map that arrives by email can be corrected
and saved by whoever received it, with no access to the JSON it came from.

`SOURCE_DOC` is the document as validated, byte-for-byte in meaning: a test asserts it
round-trips (`JSON.parse(SOURCE_DOC)` deep-equals the input document) so the viewer can
never save a document that silently differs from the one that was rendered.

## The operations in detail

Every target is **chosen from a menu built out of the document** — a group from the
declared groups, an endpoint from the declared nodes, a kind from the six, a layer from
the four, a colour from the seven. No free-text id is ever typed, so no operation can
name something that does not exist.

### 1. Reattach a connection

On an edge's card: **Reattach** → pick which end moves (`from` or `to`) → pick the new
node from a filtered list of node labels. `type` and `condition` are untouched, so a
conditional edge stays `dashed` and keeps its branch label.

Refused, with the reason shown: an edge to itself; an edge that would duplicate an
existing `from → to` pair.

### 2. Delete a connection

On an edge's card: **Delete connection**.

Refused when it would strand a node: the spec forbids a node with zero edges unless it
is the only node in its group. The refusal offers the fix — *"Deleting this leaves Dana
with no connections. Delete Dana as well?"* — rather than saving a document the engine
will reject.

### 3. Move a node to another group

On a node's card: **Group** → any declared group, or *No group*. Groups do not nest, so
there is nothing further to check. The frame the node leaves and the one it joins are
both re-fitted on re-render.

Creating a new group is **not** in scope: a new group needs a label and a colour from
the ramp, which is authoring, not correction. Ask a skill for it.

### 4. Change which layers a node is on

On a node's card: the four layer checkboxes. At least one must stay on; `base` is not
special here (a node can be `business` only), but an empty `layers` array is refused.

### 5. Change a node's kind

On a node's card: **Kind** → one of `service`, `human`, `external`, `manual`,
`artifact`, `logic`. Previewed in place, since only the ring and glyph change.

When the node carries a brand `icon` and the new kind is not `service`, the viewer
clears the icon and says so in the change list ("cleared its icon `stripe`"). A person
node wearing the Stripe mark is exactly the kind of wrong a correction exists to undo.

### 6. Edit, add or delete a sticky note

On a note: **Edit** (content, colour, layers, attachment), **Delete**. On a node's
card: **Add note here**, which creates a note attached to that node.

Limits enforced in the viewer, because they are the document's: content is the same
Markdown subset, at most 2,000 characters; colour from the seven; `attachTo` entries
picked from existing node and group ids; at most 20 notes. A new note's id is
`n_user_1`, `n_user_2`, … skipping any id already in use.

### 7. Accept a suggested node

On a suggested node's card: **Accept**. The document change is the one
`docs/SPEC.md` already defines — `status`, `rationale` and `cites` go, `integration`
stays, `source` becomes `user` — so an accepted suggestion becomes an ordinary
confirmed node that the completeness checks now count.

### 8. Decline a suggestion, or delete a wrongly mapped node

On the card: **Decline** (suggested nodes) or **Delete node** (any node). Both remove
the node and every edge touching it.

Two refusals, each with the fix offered:

- it strands another node (the orphan rule again);
- a suggested node **cites** it. `cites` entries must name declared, non-suggested
  nodes, so deleting a cited node breaks that suggestion. The viewer offers to decline
  the suggestion as well.

### Deliberately not in scope

- **Free dragging and any stored position.** The spec's root rule.
- **Editing labels, sublabels, descriptions, prompts and rationales.** That is writing,
  not correcting, and the skills do it conversationally with the whole conversation as
  context.
- **Adding nodes or edges.** A new node needs a kind, a group, a layer set, an icon and
  a description to be worth drawing. Ask a skill.
- **Answering an `open` node.** An answer is an interview turn: it replaces the question
  with a confirmed node and usually adds edges. `business-map` owns it.
- **Creating groups**, as above.

## Saving

**Save corrected JSON** produces two files in one action:

| File | What it is |
|---|---|
| `<name>-corrected.json` | the full corrected document, valid against `schema/sequentdraw.schema.json`, ready to render |
| `<name>-changes.md` | the change list, in the order the corrections were made |

`<name>` comes from the document title, lowercased, non-alphanumerics collapsed to `-`,
capped at 60 characters, falling back to `map`.

The panel then prints the command that closes the loop, ready to copy:

```
sequentdraw render <name>-corrected.json <name>-2.html
```

### Why the corrected document, and not a patch

`check --merge` takes an additive patch (`nodes`, `edges`, `notes`, `remove`). It
cannot express "change this node's `parentId`" in place: it would have to remove the
node — which removes every edge touching it — and re-add the node *and* all those
edges. For a one-field correction that is a large, lossy patch.

The corrected document is therefore the machine-readable output, and the change list is
for people. A skill that wants a patch can diff the two documents; the engine validates
the corrected document on render either way.

### The change list

Markdown, one line per correction, each naming the thing by its label rather than its
id, with the previous value:

```markdown
# Corrections to "Medusa return flow"

Made in the viewer on 2026-09-19, against a map rendered from
`medusa-return-flow.json`. 6 corrections.

- Moved **Stripe** from *Fulfillment* to *Payment*.
- Reattached **Return id and the items approved for refund**: now *Inspection* →
  *Refund check* (was *Inspection* → *Payment module*).
- Deleted the connection *Customer* → *Support* ("no response in 5 days").
- Changed **Site visit** from `service` to `manual`, and cleared its icon `stripe`.
- Accepted the suggested integration **Twilio SMS** (`twilio`).
- Edited the note "Refund cap".
```

Provenance: any node an operation changes gets `source: "user"`, the same mark an
accepted suggestion gets. A reader of the corrected document can then tell what came
from a scan, what came from the model, and what a human fixed by hand. An edge carries
`source` too (`src/n8n/validate.js`), but a reattached edge is left alone: it is the
same connection, and stamping it would claim the user authored the connection rather
than moved one end of it. The change list is where that is recorded.

### In an artifact host

Skills render with `--fragment` into a Claude artifact, where a download may not reach
a filesystem. In fragment mode the primary control is **Copy corrected JSON**, with the
downloads offered beside it, and the panel says to paste it back into the conversation —
where the skill applies it and re-renders. The operations and their rules are identical.

## Validity: two gates, and which one is authoritative

**The engine is authoritative.** `validateDoc` runs on render, as it does for any
document, and a corrected document that somehow breaks an invariant is rejected loudly
there.

The viewer's own guards exist so that never happens in practice, and so the user learns
the reason at the moment of the mistake rather than at the next command. They are the
subset that can be checked without the catalogue or a layout pass:

- every id named by an operation exists (menus only, never typed input);
- no self-edge, no duplicate `from → to`;
- no node left with zero edges unless it is alone in its group;
- at least one layer per node; kind from the six; colour from the seven;
- note content at most 2,000 characters; at most 20 notes; `attachTo` targets exist;
- `cites` stay intact: no operation may leave a suggested node citing a node that is
  gone or has become suggested;
- the suggestion cap is never approached, since correction only removes suggestions.

Not checked in the viewer, and left to the engine: anything needing the integration
catalogue, the completeness checks, and every geometric invariant (overlaps, label
collisions, note placement), all of which depend on the layout the re-render computes.

## Interaction

| Input | Behaviour |
|---|---|
| **Correct** button in the control bar | Toggles the mode. `aria-pressed`, keyboard reachable. Outside the mode the viewer behaves exactly as it does today. |
| In the mode | Cards pin on click as usual and grow an **edit** section; the controls are real `<select>`, `<input type="checkbox">` and `<button>` elements, so keyboard and screen-reader behaviour is the platform's. |
| Pending changes | A badge on every changed node, edge and note; a count on the **Correct** button; the change list open in a side panel. |
| Undo | Every operation is reversible, last first, plus **Reset all**. The undo stack is the list of operations, replayed from `SOURCE_DOC`, so undo can never drift from what will be saved. |
| Escape | Closes a menu, then unpins the card, then leaves correction mode. Never discards pending changes. |
| Leaving the page with pending changes | `beforeunload` warns, because the file has no other copy of them. |
| Reduced motion | No transitions on the panel or the badges, matching the details card. |
| Layers | Hidden nodes are not focusable and cannot be corrected. Toggling a layer back on restores access; pending changes on a hidden element stay in the list. |

## Implementation shape

One new pure module, `src/n8n/correct-ops.js`, holding the whole of the logic above as
small top-level functions: `applyOp(doc, op)` → the new document, `guard(doc, op)` →
`null` or a refusal with its offered fix, `describeOp(doc, op)` → the change-list line,
plus the per-operation helpers those three dispatch to.

It follows the convention `edge-visibility.js`, `handle-visibility.js` and
`frame-box.js` already set for logic the viewer needs: the module is authored in plain
ES5 `var`/`function` style, and `render-shell.js` inlines a verbatim copy of each
function into the single `<script>`, because the browser cannot `require()` it.
`tests/n8n-inlined-functions.test.js` compares each inlined copy with its module source
with all whitespace stripped, so the two cannot drift: a renamed variable, a different
operator or an added line fails the test. The new functions join that test rather than
introducing a second mechanism.

The rejected alternative was reading the module at require time and stripping its
export line. It removes the duplication, but it puts file IO behind a renderer
documented as pure, and it makes the shipped viewer depend on a file the npm `files`
list has to keep in step. Verbatim copies with a parity test are what this codebase
already trusts.

Because of that duplication cost, the split matters: `correct-ops.js` holds the
decisions (what an operation changes, what refuses it, how it reads in the change
list), and the viewer script holds the wiring the browser owns anyway — menus built
from `SOURCE_DOC`, the operation stack, badges, the panel, the downloads.

## Security

Correction mode reads untrusted input and writes a file the user will open again.

- `SOURCE_DOC` is embedded by the same `safeJson()` as every other literal (`<`, U+2028
  and U+2029 escaped) and parsed with `JSON.parse`.
- Every label, note body and refusal message reaches the DOM through `textContent`.
  Nothing in correction mode uses `innerHTML`.
- Downloads go through `Blob` + `URL.createObjectURL` with `application/json` and
  `text/markdown`, and the object URL is revoked after the click. The filename is
  derived from the title through the sanitiser above, so a title cannot steer a path.
- The corrected document is re-validated by the engine on render, so a hand-edited HTML
  file cannot smuggle an invalid document through the viewer.
- No network access is added. The file keeps working from `file://`.

## Testing

Engine tests (offline, deterministic):

1. `SOURCE_DOC` round-trips: rendering `examples/medusa-return-flow.json` and parsing
   the embedded literal deep-equals the input document.
2. `applyOp` for each of the eight operations against the Medusa fixture: the expected
   document change, and nothing else changed (deep-equal against a hand-built expected
   document).
3. `guard` refuses each case named above — self-edge, duplicate edge, stranded node,
   empty layers, broken `cites`, note cap, unknown colour — and returns the offered fix.
4. Every document `applyOp` produces from the fixture passes `validateDoc` and renders.
5. Replaying the whole operation stack from `SOURCE_DOC` gives the same document as
   applying the operations one by one (the undo invariant).
6. `describeOp` output is stable text for each operation, so the change list is
   reviewable in a diff.
7. Each inlined copy matches its `correct-ops.js` source exactly, whitespace aside
   (`tests/n8n-inlined-functions.test.js`), and the output still holds exactly one
   `<script>`.

Viewer behaviour that needs a DOM (menus, badges, downloads) is covered by the existing
rendered-output assertions plus one screenshot check at the M3 gate. No new skill and no
new eval case: correction mode adds no skill surface, and the skills' conversational
corrections already have cases.

## Open questions for the owner

1. **Adding a sticky note** (operation 6, the "add" half) is the one place correction
   mode authors new content rather than fixing existing content. It is included because
   "this step is wrong because…" is the most common thing a reader wants to leave on a
   map they have been sent. Keep it, or cut it to corrections only?
2. **Two files on save.** The alternative is one download plus a copy button for the
   change list. Two files is chosen so the change list survives the click; say if one
   file is preferred.
3. **+15% file size** for `SOURCE_DOC` on every render, including renders nobody will
   correct. The alternative is a `--correct` flag on `render`, at the cost of a map that
   turns out to need a correction not being correctable. Always-on is chosen.
