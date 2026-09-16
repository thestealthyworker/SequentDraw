# Design: n8n visual style

Status: **accepted** · 2026-09-15. The owner chose n8n style, flowing left to right.
Implemented in `src/n8n/` (PR #8).

## Decision

SequentDraw maps adopt the visual language of the n8n workflow canvas. Readers who
know n8n should recognise a SequentDraw map as a workflow at a glance.

This is a **re-implementation from a written description**. n8n is published under
the Sustainable Use License, which limits use to internal or non-commercial purposes.
No n8n source, CSS, SVG path data or icon assets may enter this MIT repository. The
values below are measurements and behaviours, recorded so they can be built
independently. n8n is credited as a design reference in [`CREDITS.md`](../../CREDITS.md).

Research sources, both from a shallow clone of `n8n-io/n8n` at `4f26727e`:

- the canvas implementation (Vue Flow editor, design-system tokens, `useCanvasLayout`)
- 1,155 workflow JSON files. All flow left to right; the median has 3 nodes, the
  largest 46. Consecutive nodes sit about 254px apart; IF/Switch branches step
  about 192px vertically.

Key values were re-checked against source after the research pass: the 16px grid,
96px nodes, 96/128px spacing, dagre `LR` with components stacked `TB`, and the
130px/40px backward-edge detour.

## Visual grammar

### Canvas

| Element | Value |
|---|---|
| Grid | 16px unit. Node positions snap to it. |
| Background | Dot grid with a 16px gap, mid-grey dots, very light neutral fill; near-black in dark theme |
| Font | Inter, falling back to `system-ui`. No web font is loaded, so the file stays self-contained. |
| Viewer | Pan and zoom, fit to view on load, zoom in/out/fit buttons along the bottom edge |
| Chrome | Borders and edge strokes keep a constant on-screen width at any zoom (non-scaling stroke). Handles and text scale with the canvas; counter-scaling them as n8n does is not implemented. |

### Nodes

| SequentDraw concept | n8n-style rendering |
|---|---|
| Any node | 96×96 rounded square, 20px radius, 1.5px hairline border (black at ~10% alpha), white fill |
| Icon | Centred. Brand icon at 48px; the kind glyph at the same visual weight when no brand resolves. |
| `label` | Below the node, 16px, weight 500, centred, max 2 lines |
| `sublabel` | Under the label, 13px, weight 400, tinted grey, 1 line |
| Entry node (no inbound edges) | Trigger "D" shape: left side rounded to 36px, right side 20px |
| `kind: external` | Dashed border. Keeps the spec rule that the boundary marks where control ends. |
| `status: open` | 2px dashed border, muted fill, "?" badge at bottom-right (after n8n's placeholder node) |
| `status: suggested` | 2px border in the secondary purple plus a badge. Must stay distinct from `open`. |

### Handles and edges

| Element | Value |
|---|---|
| Handles | 16px dots. ONE shared input handle (left edge, vertically centred) and ONE shared output handle (right edge, vertically centred) per node, used by every plain edge attached on that side. Drawn only where at least one edge attaches. SequentDraw is not an editor, so there is no "+" affordance. |
| Branch handle | An edge carrying a `condition` is a branch and gets its own dedicated output handle instead of sharing the main one, spread evenly alongside it when both kinds coexist on a node — n8n's branch-label convention. This is the only case a node shows more than two handles. |
| Forward edge | 2px bezier from output handle to input handle, pale grey, small open-chevron arrowhead, when nothing sits between source and target. When another node (or an unrelated frame) is in the way, it falls back to the same rounded-orthogonal shape as a backward edge, routed to actually clear the obstacle. |
| Backward edge (target left of source) | Two-segment rounded orthogonal detour: stub right off the source, drop to clear the lowest node box in the x-range it spans (130px below the source as a floor, deeper if something is still in the way), run across, come back into the target; 40px stubs, 16px corner radius. |
| `type: dashed` | `5 6` dash pattern. n8n reserves this for non-main connections; here it keeps the spec meaning: conditional, retry or return. |
| `condition` | 12px label set beside the edge's dedicated branch handle on the source node (see Handles row above), not a floating midpoint chip — avoids repeating the same text twice on one edge. |

### Groups

n8n has no transparent dashed containers. Groups render as **frames** that borrow
the sticky-note look: 4px radius, 1px border, a pastel fill from a fixed palette
(one swatch per SequentDraw group colour), and the title at top-left. Frames sit
behind nodes. Groups remain the only spatial axis (handover finding 6).

### Notes (text boxes)

n8n workflows use sticky notes to explain what a section does. SequentDraw adds them
to the IR as a top-level `notes` array. Like everything else, a note stores meaning,
not position.

```jsonc
"notes": [
  {
    "id": "n_inspection",
    "content": "## Inspection\nItems are checked by hand. **Damaged** stock is not resold.",
    "attachTo": ["receive", "inspect"],   // node or group ids; omit for a map-level note
    "color": "yellow",                    // yellow | gold | red | green | blue | purple | gray
    "layers": ["business"]                // same visibility rules as nodes; default ["base"]
  }
]
```

| Aspect | Rule |
|---|---|
| Look | n8n sticky-note look: 4px radius, 1px border, pastel fill from seven swatches, yellow by default. Width 240–480px, height fits the content. |
| Content | A Markdown subset: `#` and `##` headings, bold, italic, inline code, bullet lists, line breaks, and links (opened in a new tab). All raw HTML is escaped before Markdown is applied. Images are not supported, so the file stays self-contained. |
| Links | Content is untrusted, so links are narrow. Only `http`, `https` and `mailto` URLs become links. A URL containing whitespace, a quote or an angle bracket renders as plain text. A `mailto` link keeps only the address; query parameters such as `cc`, `bcc` and `body` are dropped, so a note cannot add hidden recipients. Every other scheme (`javascript:`, `data:`, protocol-relative `//`) renders as plain text. |
| Attached note | Placed by the engine beside the nodes or group it names — within one node-spacing (128px) of every one of them where that is possible — never overlapping a node, label or frame title. It may sit over the empty body of a frame it names or that its targets belong to, which is where a reader expects a note about a grouped node. The engine sweeps all four sides at growing offsets and slides along each side, scoring candidates by how many targets they reach, so a note beside a tall stack ends up level with it rather than merely on the right side of a bounding box. Placement comes from the layout, so it is deterministic. |
| Note connector | Some notes name things too far apart to sit beside both (the Medusa fixture attaches one to two nodes the layout puts 1,100px apart). The note is placed beside what it can reach, and a thin dashed line in the note's own border colour runs to each target it could not, so the note is never read as belonging to whatever it happens to float next to. The line is **routed**: straight where a straight line is clear, otherwise the shortest one- or two-bend orthogonal detour that clears every other node, note and group title, keeping 12px from each. It may cross a frame's border — a note outside a frame has to, to reach a node inside it — but never a node's body or label, because a leader drawn through an unrelated node attributes the note to that node instead. A connector follows its **target's** visibility, not the note's: when a layer toggle hides the target, the line goes with it, leaving no leftover. |
| Map-level note | A note without `attachTo` sits at the top-left of the canvas and describes the whole workflow. |
| Layers | A note is shown when any of its layers is visible. |

Invariants, enforced loudly like the rest of the schema:

- every `attachTo` id exists as a node or group
- `content` is non-empty and at most 2,000 characters
- `color` is one of the seven swatches
- at most 20 notes per map

In plugin form this is how Claude or Codex writes explanations into a map.

**Consideration notes.** A note that raises something the reader should think about,
rather than describe, uses `gold` by convention and starts with "Consider:". Skills
write these (`business-map`, `eval-build`) and never state them as fact. The Medusa
fixture carries a few hand-written examples.

### Details card (hover, tap or keyboard)

Owner feedback (2026-09-15): the maps look right but say too little about what each
node does and how the integrations connect. Shapes alone do not explain a system.
Every node and edge therefore has a details card.

IR additions, all optional:

```jsonc
{ "id": "pay_provider", "label": "Payment provider", "kind": "service", "icon": "stripe",
  "description": "Stripe issues the refund to the customer's original payment method.",
  "link": "https://docs.stripe.com/refunds" }

{ "from": "pay_mod", "to": "pay_provider", "type": "solid",
  "description": "Refund amount and the original payment intent id" }
```

| Field | Rule |
|---|---|
| node `description` | Plain text, at most 280 characters, line breaks kept. What the node does in this system, not what the product is in general. |
| node `link` | One URL, at most 300 characters, to vendor or internal docs. The same narrowing as note links: `http` or `https` only; whitespace, quotes and angle brackets rejected by validation. |
| edge `description` | Plain text, at most 200 characters. What passes along this connection: data, a document, a message, money. |

**Node card** shows:
- the icon, label and sublabel
- badges for kind, group and layers, plus status
- the description
- for `open` nodes, the `prompt` as "Open question: …"
- for `suggested` nodes, the `rationale` as "Why suggested: …"
- **Receives from** and **Sends to**: every connected node, each with its edge
  description or condition when present, derived from the edges so every map gets
  them even with no descriptions written
- the docs link, which opens in a new tab

**Edge card** shows "From → To", what the line style means (solid: always happens;
dashed: conditional, retry or return), the condition, and the description.

Interaction:

| Input | Behaviour |
|---|---|
| Pointer hover | Card appears after 150ms and hides on leave. The node's connected edges and neighbours are highlighted and everything else dims, the way n8n emphasises a selection. |
| Click or tap | Pins the card. Clicking empty canvas or pressing Escape unpins. Touch devices have no hover, so this is their path. |
| Keyboard | Nodes and edges are focusable in reading order (`tabindex="0"`, a descriptive `aria-label`). Focus shows the card; Enter pins; Escape closes. |
| Zoom and pan | The card is an HTML overlay outside the SVG transform: it keeps a constant, readable size, sits beside its target, and flips to stay inside the viewport. |
| Hidden layers | Connections to hidden nodes are listed with "(hidden)". Hidden nodes and edges are not focusable, and a pinned card closes if its target is hidden. |
| Deep link | Opening the file with `#focus=<node id>` or `#focus=<from>-><to>` pins that card and pans it into view. The hash is only compared against ids in the data; it never builds a selector. Useful for sharing a link to one node, and for automated screenshots. |
| Reduced motion | No fade or dim transitions under `prefers-reduced-motion`. |

Security: card text comes from untrusted input. Card data is embedded inside the single
viewer script as a JSON literal (with `<`, U+2028 and U+2029 escaped) and written to the
DOM only through `textContent` and validated `href` attributes, never `innerHTML`.
The output keeps exactly one `<script>` element.

### Documentation export (SVG with inline captions)

Owner feedback (2026-09-15): hover cards leave a gap. A screenshot, PDF or pasted
image cannot hover, so documentation needs the same information printed on the map.
Decided with the owner: inline captions, SVG output, driven by the `doc-map` skill.

The interactive HTML stays the primary output. The documentation export is a second,
static output from the same document:

| Aspect | Rule |
|---|---|
| Format | One standalone `.svg` file: no script, no external references, fonts from the system stack. Generated by the engine without a browser. |
| Captions | Under each node's label and sublabel, the node `description` is wrapped at 12px onto as many lines as it needs and printed **in full**. Nodes without a description get no caption. The figure is read where nobody can hover, so a caption that stopped mid-sentence would say less than the label already did; the line cap in `constants.js` is a guard against pathological input, not a design limit, and no schema-legal description reaches it. |
| Edge text | An edge `description` or `condition` is drawn as a small wrapped label on its connection, in full, only where it fits clear of nodes, labels and other text. It is never truncated and never forced in: a label with nowhere to sit is omitted instead. |
| Layers | Chosen at export time (`base` is always included). Nodes outside the chosen layers are omitted, not stubbed, so each figure shows exactly what it is about. |
| Look | Same n8n visual grammar, minus the viewer: no dot grid, no zoom or layer controls, no hover highlighting. White background, a title at the top, cropped to the content with a 32px margin. |
| Layout | Computed separately from the interactive view, because captions need vertical room: the reserved label strip grows by the caption height. The same routing rules and measurement tests apply: zero node, label, caption and note crossings. |
| Notes | Sticky notes are included, rendered as in the interactive view; links become plain underlined text, because an image cannot be clicked. |
| Interface | `renderSvg(doc, { layers })` in the core; CLI `node src/n8n/cli.js <in.json> <out.svg>` picks SVG from the extension, with `--layers` as the only option. |

Security: the SVG is as likely as the HTML to be opened by people who did not write the
input. Every value is escaped for its context, there is no `<script>`, `<foreignObject>`
or event attribute, and there are no `href` values at all.

### Layers

Unchanged in meaning: layers are a visibility filter over one layout. The checkbox
bar becomes a pill-shaped control bar that floats over the canvas.

## Layout

The prototype's layout findings still hold where they are about ELK mechanics:
`edgeCoords: ROOT` (finding 2), declaring the node as the shape and reserving label
space through spacing (finding 3), and per-container spacing (finding 4). The
direction and routing findings are superseded, as listed below.

**Engine: keep elkjs.** It handles groups as real containers, which dagre does not.
n8n's dagre usage is a strategy reference, not a reason to switch.

Left-to-right was the risk: the prototype measured an unusable 4000×669 strip for
Medusa with `RIGHT`. n8n's defence, splitting the graph into disconnected components
and stacking them vertically, does not help Medusa, which is one connected component.

**Decision: a single flat `RIGHT` layout, read in a pan/zoom viewer.** A wide canvas
is normal in n8n because nobody reads it as a static page. Two strategies were
prototyped and measured on Medusa:

| Strategy | Canvas | Foreign-frame crossings | Backward edges | Result |
|---|---|---|---|---|
| Flat: one ELK pass across all groups | 4000×1568 | 2 | 6 | **Chosen** |
| Rows: each group laid out `RIGHT`, frames stacked top to bottom | 1856×3456 | 11 | 11 | Rejected. Medusa's groups all cycle through the order domain, so stacked full-width frames force long edges through each other. Removed from the code. |

After the routing polish that followed, the flat layout measures 0 foreign-frame
crossings, 0 edges through label text and 0 edges through nodes, on the same canvas.

How the flat layout stays readable:

- **Spacing** follows n8n: 128px between ranks, 96px between nodes in a rank, and
  positions snapped to the 16px grid.
- **Direction.** Real process graphs have cycles (a notification loops back to the
  customer). A feedback-arc-set pass decides which edges to reverse for layout only.
  It orders groups first, then nodes within each group, and prefers reversing
  `dashed` (return or retry) edges. So the flow starts at the left, and arrows still
  point from the true source to the true target.
- **Routing.** An edge is a bezier only when its path is clear. Otherwise, and for
  every backward edge, it is a rounded orthogonal route that clears node boxes, label
  text and frame titles.
- **Validation.** Positions are measured, not trusted: tests assert zero node
  crossings, zero edges through label or frame-title text, and zero label overlaps
  on Medusa.

### Hidden layers

Drop the prototype's compaction. It degraded routing (a known defect), and n8n never
moves nodes when things are hidden. Hidden nodes keep their positions.

Owner rule (2026-09-15): toggling a layer leaves no leftovers.

- An edge is shown only when both of its endpoints are visible; otherwise the whole
  edge is hidden, with no stub marker.
- A handle with no visible edge is hidden, and a branch handle hides with its own edge
  and label.
- A group frame shrinks to the bounding box of its visible members (same padding, title
  moving with it), and is hidden when none are visible. Edges are not re-routed.
- The details card lists connections to hidden nodes as "(hidden)", so nothing is lost.

The visibility rules live in small pure functions (`edge-visibility.js`,
`handle-visibility.js`, `frame-box.js`), shared with the viewer. Tests keep the
viewer's inlined copies identical to the tested source.

## What this supersedes

| Source | Previous rule | Now |
|---|---|---|
| SPEC · Edges at a visibility boundary | An edge into a hidden node ends in a stub marker | The whole edge hides; handles and frames follow; the details card lists hidden connections |
| SPEC · Nodes | "The icon is the node. No box around it." 44px circle | 96px rounded-square node, icon inside |
| SPEC · Edges | "Orthogonal routing only. No diagonals, no curves." | Bezier where the path is clear; rounded orthogonal routes around obstacles and for backward edges |
| SPEC · Splits | A shared horizontal rail fanning into targets | A labelled branch handle per `condition` edge |
| SPEC · Groups | Transparent fill, dashed 0.5px border | Pastel frame, 4px radius, 1px border |
| HANDOVER · Finding 5 | Default flow `DOWN` | `RIGHT`, one flat layout |
| HANDOVER · Known defects | Compaction when layers are hidden | Removed; gaps plus stubs, per SPEC |

SPEC.md and HANDOVER.md carry pointers to these replacements.

## Testing

- The legacy renderer (`src/render-html.js`) and its regression test stay as a record
  of the prototype until they are retired.
- The n8n renderer has invariant tests on the Medusa fixture: no node overlaps; every
  node on the 16px grid; every edge endpoint within 1px of a handle; no node crossed
  by an edge; no label overlaps; frame boxes containing all their members.
- Security tests cover hostile input: validation rejects out-of-spec values, and
  escaping leaves exactly one script element in the output.
- `scripts/measure-n8n-layout.js` reports canvas size, crossings, backward edges and
  overlaps for any change to layout or routing.

## Out of scope

Editor affordances (the "+" handle, toolbars, drag and resize), execution-state
animation, and n8n node-type icons, which belong to n8n.
