# Workflow Designer — handover

> Carried over from the claude.ai web discussion. "Workflow Designer" was the working
> name; the tool is now **SequentDraw**.

Prototype is working. This document is the brief for turning it into a repo and a
Claude plugin. Read `workflow-designer-spec.md` first for the product design; this
file covers what was built, what was proven, and what is left.

## What this tool is

Generates architecture and business-process maps as self-contained interactive HTML.
One JSON file describes the system semantically. Layout is computed, never authored.
Layers can be toggled so the same map serves a developer and a client.

Not a diagram editor. Not an n8n replacement. The JSON is the product; the HTML is a
view of it.

## Pipeline

```
input  →  workflow.json  →  ELK layout  →  HTML render
         (semantic only)   (deterministic)  (deterministic)
```

Stage 1 is the only place a model is involved. Stages 2 and 3 are pure functions and
are testable without a model, which is how the prototype was validated.

## Status

| Component | State |
|---|---|
| IR schema | Settled. See spec. |
| ELK layout | Proven at 40 nodes / 5 groups / 44 edges. Zero overlaps. |
| Icon resolution | Working via `simple-icons` npm, with kind-glyph fallback. |
| HTML renderer | Working. Layer checkboxes, dynamic containers, gap compaction. |
| Extraction (prose → JSON) | **Not built.** Highest-risk component. |
| Tours | Specified, not built. |
| Gap detection | Specified, not built. |

## What is in `src/`

- `render-html.js` — the real renderer. Reads a workflow JSON, runs ELK, emits one
  self-contained HTML file. This is the file to build the repo around.
- `icons.js` — Simple Icons lookup plus six `kind` glyphs used when no brand exists.
- `layout.js` — earlier experiment harness. Renders plain rectangles and reports
  overlaps and container violations. Keep as a test tool, not a product path.
- `check.js` — measurement script: edge-attachment error and label collisions.
  Worth promoting into an automated test.

Run: `node src/render-html.js examples/medusa-return-flow.json out.html`

Dependencies: `elkjs`, `simple-icons`. Nothing else.

## Findings that must not be relitigated

These cost real time to establish. Each is written as a rule because rediscovering
them is expensive.

**1. Positions are never stored.** The JSON carries meaning only. ELK computes
coordinates at render time. This is what allows one file to serve every layer
combination without divergence. It is also why `cc-wf-studio`'s schema could not be
adopted — it stores `position: {x, y}` because it is a canvas document.

**2. ELK returns edge coordinates in mixed reference frames.** Edges between two
nodes in the same container are stored on that container and returned relative to
it; cross-container edges are stored at root. Applying one offset to all of them put
edges up to 1450px out of place. Fix: set `elk.json.edgeCoords: 'ROOT'`. This was
the single worst bug in the prototype and it looks like a routing problem, not a
coordinate problem.

**3. The node is the icon, not the icon plus its labels.** Declaring the node as the
full label cell makes ELK route to the edge of the text block, which reads as
misaligned arrows. Declare the node as the 44px circle and reserve label space via
spacing. Edge attachment error dropped from 1450px to 5px.

**4. `elk.margins` is ignored in elkjs 0.12.** Reserve label space with
`elk.spacing.nodeNode` instead, and set spacing on each container's `layoutOptions`
— it does not inherit from root.

**5. Flow direction dominates readability.** `DOWN` gives a portrait page
(1326×1954 on the Medusa example). `RIGHT` gives an unusable 4000×669 strip. Default
to `DOWN`.

**6. Bands do not work.** An attempt to give each layer its own horizontal band
failed: every group in a real system spans all three layers, so banding shatters 5
containers into 20 fragments. ELK's partitioning also runs along the flow direction,
not across it, so it cannot express bands anyway. **Groups are the only spatial
axis. Layers are a pure visibility filter.**

**7. Most nodes have no logo.** On the Medusa example only 7 of 40 nodes resolved to
a brand icon; the rest were internal modules, data models, humans and logic. The
icon-first grammar was designed for stack maps where most nodes are third-party
services. For internals the glyph set and labels do the identification work. Open
design question, not a bug.

## Known defects

- **15 edge segments cross containers they do not belong to.** Four candidate fixes
  are discussed at the end of the spec. Cheapest first: tune
  `elk.layered.considerModelOrder` and `elk.spacing.edgeNode`. Worth questioning
  whether the constraint matters at all now that containers are transparent.
- **6 label pairs overlap** out of 780. Increasing spacing did not resolve them, so
  the cause is unidentified. Needs isolating.
- **Compaction degrades routing.** When layers are hidden, nodes slide up to close
  gaps and edges are redrawn as simple three-segment orthogonals, because ELK's
  routing cannot survive its nodes moving. The compacted view is denser but its
  lines are plainer and may cut through containers. Possible improvement: re-run ELK
  on the visible subgraph in a worker, accepting a larger bundle.

## Building the plugin

The plugin should expose the tool through at least two input modes. They are
genuinely different interactions and should not be collapsed into one.

**Mode A — repo scan (technical).** Point at a codebase, extract services, data
stores, external integrations and the flow between them. Code is good evidence for
this layer. Output is the `base` layer, largely complete.

**Mode B — business interview.** Cannot be derived from a repo. The important
business nodes (a phone call, a site visit, a confirmation over WhatsApp, an invoice
no system touches) have no code, and absence is invisible to a scanner. Start from
the unit of value and trace one full lifecycle from "work is needed" to "paid and
obligation discharged". Use the codebase as negative space: every boundary in the
code generates a question, not a node. Roughly eight questions, then write the
answers into the JSON as `business` and `edge` layer nodes.

A third mode was raised and is not yet specified: **taking an existing documented
business methodology as the input** and rendering its process as a map. The specific
methodology named in discussion was not captured clearly enough to write down —
confirm which one is intended before building this. The mechanism is the same as
Mode B; only the question set changes.

Gap handling applies to all modes: anything the tool cannot establish is rendered in
the map as an open node with `status: "open"`, not omitted and not guessed. The map
is the questionnaire.

## Proposed feature: suggestion agent

An agent that proposes tools or steps the design appears to be missing, rendered
into the map as suggestions rather than described in prose.

This introduces a third node state. Keep all three visually distinct:

| State | Meaning | Source |
|---|---|---|
| `confirmed` | Established from the input | scan or user |
| `open` | You have this, but it is unspecified | gap detection |
| `suggested` | You do not have this; consider it | suggestion agent |

```jsonc
{
  "id": "s_queue",
  "label": "Job queue",
  "kind": "service",
  "status": "suggested",
  "rationale": "Three long-running steps are chained synchronously.",
  "source": "model"
}
```

Design constraints, learned from the gap-detection work:

- A suggestion must carry a `rationale` tied to something in the user's own design.
  "Most pipelines have a queue" is not a rationale; "three long-running steps run
  synchronously" is.
- Suggestions never enter the graph silently. Accepting one flips it to `confirmed`
  and is a user action; declining removes it. Until then it renders distinctly.
- Cap them. An agent asked for missing tools will happily propose fifteen, and a map
  where half the nodes are the tool's opinion is no longer documentation. Three to
  five per map.
- Watch for popularity bias. The model will reach for whatever stack appears most in
  training data, which is systematically wrong for a Singapore SME or a solo
  founder's budget. Suggestions should be constrained by what is already in the
  graph, not by what is common.

Order matters: build gap detection first. A tool that guesses at what you should add
before it can reliably describe what you have will not be trusted.

## Recommended build order

1. Lift `render-html.js` into a proper package with the JSON schema validated on
   input. Fail loudly on the invariants listed in the spec.
2. Promote `check.js` into automated tests. Assert zero node overlaps, edge
   attachment within 5px, zero label collisions. These are the regression tests that
   make everything after this safe.
3. Fix the two known defects above.
4. Build extraction, Mode A first. It is the easier half and produces a testable
   artifact.
5. Build Mode B as a question flow, with gap rendering.
6. Suggestion agent, after gap detection is trustworthy.
7. Tours last.

## Validation material

`examples/medusa-return-flow.json` — 40 nodes, 5 groups, 44 edges, 4 layers,
hand-written from Medusa's published RMA documentation. Use as the layout regression
fixture; it is deliberately harder than a typical input (15 of 44 edges cross
layers).

`examples/stampedid-workflow.json` — 15 nodes, smaller, real project. Better for
testing extraction accuracy later, since ground truth is known.
