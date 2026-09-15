# Design proposal: n8n visual style

Status: **proposed** · 2026-09-15

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
| Chrome | Handles, labels and borders counter-scale with zoom and stay a constant on-screen size |

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
| Attached note | Placed by the engine beside the bounding box of the nodes or group it names, never overlapping a node, label or frame title. Its placement comes from the layout, so it is deterministic. |
| Map-level note | A note without `attachTo` sits at the top-left of the canvas and describes the whole workflow. |
| Layers | A note is shown when any of its layers is visible. |

Invariants, enforced loudly like the rest of the schema:

- every `attachTo` id exists as a node or group
- `content` is non-empty and at most 2,000 characters
- `color` is one of the seven swatches
- at most 20 notes per map

In plugin form this is how Claude or Codex writes explanations into a map.

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

Left-to-right is the risk. The prototype measured an unusable 4000×669 strip for
Medusa with `RIGHT`. n8n's defence is to split the graph into disconnected
components and stack them vertically. **That alone does not help Medusa: it is one
connected component.** Two candidate strategies go to a measured prototype:

- **A: flat `RIGHT`.** One ELK pass across all groups, as the prototype did, but
  shown in a pan/zoom viewer. A wide canvas is normal in n8n because nobody reads
  it as a static page.
- **B: group rows.** Lay out each group internally with `RIGHT`, then stack the
  group frames top to bottom in the order the group-level graph flows. Cross-group
  edges use the backward-edge detour where needed. This mirrors n8n treating a
  frame as one layout unit, and stacking in the cross axis.

Both use n8n spacing: 128px between ranks, 96px between nodes in a rank, positions
snapped to the 16px grid. We choose on numbers from the Medusa fixture: canvas
aspect ratio at fit-to-view, edges crossing frames they do not belong to (a known
defect today: 15), backward-edge count, and label collisions.

### Hidden layers

Drop the prototype's compaction. It degraded routing (a known defect), and n8n
never moves nodes when things are hidden. Return to the spec's rule: hidden nodes
keep their positions, and edges into a hidden node end in a stub.

## What this supersedes

| Source | Previous rule | Now |
|---|---|---|
| SPEC · Nodes | "The icon is the node. No box around it." 44px circle | 96px rounded-square node, icon inside |
| SPEC · Edges | "Orthogonal routing only. No diagonals, no curves." | Bezier forward; orthogonal detour only for backward edges |
| SPEC · Groups | Transparent fill, dashed 0.5px border | Pastel frame, 4px radius, 1px border |
| HANDOVER · Finding 5 | Default flow `DOWN` | `RIGHT`, with strategy A or B chosen by measurement |
| HANDOVER · Known defects | Compaction when layers are hidden | Removed; gaps plus stubs, per SPEC |

SPEC.md is updated once the prototype confirms the layout strategy.

## Testing

- The legacy renderer and its regression test stay until the n8n renderer replaces them.
- The new renderer ships with invariant tests on the Medusa fixture: no node overlaps;
  every node on the 16px grid; every edge endpoint within 1px of a handle; no label
  overlapping a node; frame boxes containing all their members.
- Its own reference render becomes the new positional baseline.

## Out of scope

Editor affordances (the "+" handle, toolbars, drag and resize), execution-state
animation, and n8n node-type icons, which belong to n8n.
