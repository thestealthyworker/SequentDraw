# Workflow Designer — visual grammar and IR schema

> Carried over from the claude.ai web discussion as `workflow-designer-spec.md`.
> "Workflow Designer" was the working name; the tool is now **SequentDraw**.

Version 0.1. Two things live here: the rules the renderer must obey, and the JSON
shape that feeds it. The LLM produces the JSON. It never produces coordinates.

## Pipeline

```
prose / architecture doc
        |  (LLM — semantic only)
        v
   workflow.json   <-- the spine: versionable, diffable, hand-editable
        |  (ELK — deterministic layout)
        v
 positioned graph
        |  (renderer — deterministic SVG + icon injection)
        v
      map.svg
```

Stages 2 and 3 are testable with no model in the loop. Build and prove those first
against hand-written JSON, then automate stage 1.

**Positions are never stored.** The JSON carries meaning only; coordinates are
computed at render time and discarded. This is what lets the same graph render as a
base tier, an overview, a technical layer or a business layer without divergence,
and it is why a canvas-document schema cannot be adopted wholesale.

## Visual grammar

These are hard rules. Consistency across runs is the point.

> **Rendering is now n8n style.** Sizes, shapes, colours, handles and edge routing are
> defined in [`docs/design/n8n-visual-style.md`](design/n8n-visual-style.md), which
> replaced this section's original 44px-circle, dashed-container and orthogonal-only
> rules. The semantic rules here still apply: node kinds, edge types and their meaning,
> layers, tiers, gaps and invariants.

### Nodes

- A 96px rounded-square node with the icon inside. The tool, actor or artifact name
  sits below it.
- `label` is the tool name; `sublabel` says what it does, max 3 words.
- Unresolved icon: the kind glyph. Never guess a brand.

### Groups

- One group per sub-workflow, drawn as a pastel frame behind its nodes.
- One colour per group from the ramp set; title top-left inside the frame.
- Groups may not nest more than one level deep.

### Edges

| type | stroke | meaning |
|---|---|---|
| `solid` | solid 1.5px | deterministic flow, always happens |
| `dashed` | dashed 4 4 | conditional, or a return/retry path |
| `gutter` | solid, routed around | cross-group link; routed in the margin, never through a container |

- An edge never passes through a node, and avoids frames it does not start or end in.
- `condition` on an edge renders as a label beside that edge's own branch handle.

### Splits

A split is not a node. Two or more edges leaving the same source, each carrying its
own `condition`, render as separate labelled branch handles on that source, the way
n8n shows IF and Switch outputs. This keeps the map light and keeps the LLM's job
purely semantic.

### Node kinds

The tool documents design flows, not just technical stacks. A system's real shape
includes the people in it, the parties outside it, and the things it hands over.
Those are nodes, not footnotes.

| kind | example | mark |
|---|---|---|
| `service` | Postgres, WhatsApp, Gmail | brand SVG, solid ring |
| `human` | reviewer, site technician | person glyph, solid ring |
| `external` | customer, main contractor, regulator | glyph, dashed ring |
| `manual` | site inspection, phone confirmation | action glyph, solid ring |
| `artifact` | signed PDF, calendar export, job card | document glyph, solid ring |
| `logic` | confidence gate, classifier, router | neutral glyph, solid ring |

The border, not the glyph, carries the boundary: a dashed border means the node sits
outside the org. This is what makes a business-level map readable at a glance —
you can see where control ends.

`external` and `artifact` nodes are what turn an architecture diagram into a
business flow. An artifact node is the answer to "what does the product actually
hand someone", which is the question a technical map never answers.

### Layers

Selected at render time, not at authoring time. See the Layers section below for the
overlay model, the named set and the layout constraint it imposes.

### Grouping

The model proposes grouping (semantic — which nodes are the same concern). The
renderer arranges and rebalances it (geometric). If a proposed grouping cannot be
laid out readably, the renderer rejects it and requests a regroup rather than
emitting a lopsided canvas.

Balance is a requirement, not a preference. Aim for roughly even group sizes; split
a group that dominates the canvas, merge one too small to justify a container.

### Tier model

The base tier is always the node level. Every tool in the architecture is drawn as
its own icon node. This is the canonical output and the default render.
Grouping is a progressive enhancement layered on top, never a replacement:

- **Base tier** — every node drawn, containers as transparent dashed boundaries.
  Always generated. If it renders clean, no other tier is required.
- **Overview tier** — generated only when the base tier exceeds the density budget
  (~25 nodes) or when the user explicitly asks to zoom out. Groups collapse to
  tiles. Emitted alongside the base tier, never instead of it.

A collapsed tile must stay visually identifiable. Each tile carries a row of its
member icons beneath the group label, 16px each, max four, with a `+n` overflow
count. A tile that reads only "3 services" defeats the purpose of the product.

Tiles are clickable: selecting one drops to that group's base-tier detail.

## Icon resolution

1. Normalise the tool name, look it up in the local `simple-icons` slug directory.
2. Semantic resolution, not string distance. "our Postgres box" and "Vercel Postgres"
   both resolve to `postgresql`; "Claude" resolves to `anthropic`; Levenshtein gets
   none of these right.
3. Fall back to Iconify for anything Simple Icons lacks.
4. Fall back to a lettered placeholder tile. Never guess a wrong brand.

The resolved slug is written into the JSON, so resolution happens once and the map
is reproducible without re-running the model.

## IR schema

```jsonc
{
  "title": "string",
  "groups": [
    {
      "id": "string",             // unique, referenced by nodes
      "label": "string",
      "color": "purple | teal | coral | pink | blue | green | amber | gray"
    }
  ],
  "nodes": [
    {
      "id": "string",             // unique, referenced by edges
      "label": "string",          // the tool, actor, or artifact name
      "sublabel": "string",       // what it does here, <= 3 words
      "kind": "service | human | external | manual | artifact | logic",
      "icon": "string | null",    // resolved slug, null = glyph by kind
      "parentId": "string | null", // group id, null = ungrouped
      "layers": ["base"],         // base | edge | business | build
      "status": "confirmed",      // confirmed | open | suggested (see Gaps)
      "source": "scan",           // scan | user | model, optional
      "prompt": "string",         // optional; the open question for an open node
      "rationale": "string",      // required on suggested nodes, not allowed elsewhere
      "cites": ["node id"],       // required on suggested nodes, not allowed elsewhere (see Suggestions)
      "integration": "string"     // catalogue id; required on suggested nodes, allowed on confirmed and open
    }
  ],
  "edges": [
    {
      "from": "string",           // node id
      "to": "string",             // node id
      "type": "solid | dashed | gutter",
      "condition": "string | null" // renders as a branch label
    }
  ],
  "notes": [                      // optional sticky notes, see docs/design/n8n-visual-style.md
    {
      "id": "string",
      "content": "string",        // Markdown subset, <= 2,000 characters
      "attachTo": ["node or group id"], // omit for a map-level note
      "color": "yellow | gold | red | green | blue | purple | gray",
      "layers": ["base"]
    }
  ],
  "tour": [                       // optional, see Tours
    { "order": 1, "title": "string", "description": "string", "nodeIds": ["node id"] }
  ]
}
```

The machine-readable version is [`schema/sequentdraw.schema.json`](../schema/sequentdraw.schema.json)
(JSON Schema draft 2020-12). Every field carries a description, so AI tools and API
callers can read it as documentation. A test keeps it in agreement with the validator.

### Invariants the renderer validates before drawing

- every `node.parentId` exists in `groups`, or is null
- every `edge.from` / `edge.to` exists in `nodes`
- no node is orphaned (zero edges) unless it is the only node in its group (ungrouped
  nodes count as one shared group)
- `sublabel` is 3 words or fewer
- an edge carrying a `condition` is `dashed`, not `solid`
- group nesting is one level; a group may not have a `parentId`
- every entry in `layers` is one of the four named layers
- a `suggested` node has a `rationale`; no other node does
- a `suggested` node has `cites` and an `integration`, and a document has at most five
  `suggested` nodes (the rules and codes are under Suggestions)
- every note `attachTo` and tour `nodeIds` entry names an existing node or group
- ids are unique across nodes, groups and notes
- unknown fields are errors, with a "did you mean" hint for near misses (`parent_id`)
- size caps: 100 nodes, 500 edges, 50 groups, 20 notes, 50 tour steps, 200 fields per
  object, plus length caps on every string (title 120, label 80, sublabel 60,
  condition 80, prompt and rationale 500 characters)
- an edge is visible only when both endpoints are visible in the active layers (a
  render rule, not a validation error)

Fail loudly on violation. A broken diagram is worse than no diagram.

**Every problem is reported at once.** Validation throws one `ValidationError` whose
`errors` list holds `{ path, code, message }` for each problem: `path` is a JSON Pointer
such as `/nodes/3/sublabel`, `code` is stable such as `sublabel-too-many-words`, and
`message` names the offending item and the fix. An AI tool can repair a whole document
in one pass. Because input is untrusted, validation is bounded: oversized arrays fail
before per-item work, echoed input is truncated, and the list stops at 100 errors.

## Gaps and resolution

The user is a first-class input to the map, not a reviewer of it. Anything the tool
cannot establish from the material it was given is surfaced in the map as an open
question addressed to the user, and their answer becomes part of the graph on equal
footing with anything read from code. The tool is never the sole author.

The business layer cannot be derived from a repo. Code shows what is automated; the
business flow's most important nodes are the ones with no code behind them — the
phone call, the site visit, the confirmation over WhatsApp, the invoice no system
touches. Absence is invisible to a scanner.

So a scan produces questions, not nodes. Every boundary in the codebase is evidence
of something outside it: a webhook implies an upstream sender, a file upload implies
a human with a file, a role column implies people with roles, a four-value status
field implies four states someone cares about.

**Gaps are rendered, not listed.** An unresolved question is a node or edge in the
graph with `status: "open"`, drawn with a dotted ring and a question glyph, muted.
The map is the questionnaire. Answering means filling in the diagram, and a
partially answered map is still a usable artifact.

```jsonc
{
  "id": "q_pdf_recipient",
  "label": "Who receives this?",
  "kind": "external",
  "status": "open",              // open | confirmed
  "prompt": "The signed PDF is generated but no recipient appears in the code.",
  "source": "scan"               // scan | user | model
}
```

`status` defaults to `confirmed`. A node or edge the model inferred rather than
found should be marked `open` so it gets confirmed rather than silently believed.

### Completeness checks

Run against the graph, each failure emitting an open node or edge:

- every `artifact` has a named recipient
- every external input has a named source actor
- every handoff between two systems that is not an API call is an undrawn human step
- every decision has a named decider, `human` or `logic`
- the flow reaches money or a discharged obligation, not merely "record saved"
- every unhappy path has an owner: nobody responds, work rejected, customer disputes

The last one is where business flow documents are usually incomplete, and it is the
part a client cares about most.

Completeness in the absolute sense is not achievable and chasing it produces a map
nobody reads. The working definition: one full lifecycle of the unit of value, with
a named owner at every handoff. If a reader can answer "who does what next, and what
do they get", it is done.

### Suggestions

A node with `status: "suggested"` is a proposal, not a fact: an integration from
SequentDraw's catalogue (`sequentdraw catalogue`) that the host AI thinks would
improve the workflow. The completeness checks ignore suggested nodes and every edge
touching them, so a suggestion can neither close a gap nor open one. Suggestions are
workflow improvements only; nothing in the schema or the engine reasons about price,
cost or region.

| Field | On a `suggested` node | On any other node |
|---|---|---|
| `rationale` | required, at most 500 characters | not allowed |
| `cites` | required: 1 to 10 unique node ids, each a declared node that is not itself suggested | not allowed |
| `integration` | required: an id in the catalogue | allowed, so an accepted suggestion keeps it |

A document holds at most five `suggested` nodes. Accepting a suggestion removes
`status` (or sets `confirmed`), `rationale` and `cites`, keeps `integration`, and sets
`source: "user"`. Declining removes the node and its edges.

`validateDoc` reports each violation with one of these codes:

| Code | When |
|---|---|
| `rationale-required` / `rationale-not-allowed` | `rationale` missing on a suggested node, or present on another |
| `cites-required` / `cites-not-allowed` | `cites` missing or empty on a suggested node, or present on another |
| `invalid-cites` | `cites` is not an array, has more than 10 entries, or an entry is not a valid id |
| `duplicate-cite` | the same id appears twice in `cites` |
| `unknown-cite` | a `cites` entry is not a declared node |
| `cite-is-suggested` | a `cites` entry is itself a suggested node |
| `integration-required` | a suggested node has no `integration` |
| `invalid-integration` | `integration` is not a string |
| `unknown-integration` | `integration` is not an id in the catalogue |
| `too-many-suggestions` | the document has more than five suggested nodes (path `/nodes`) |

The JSON Schema enforces the shapes, the required and forbidden fields by status, and
the five-suggestion cap. Whether a cite exists, whether it is suggested, and whether an
integration is in the catalogue are checked by `validateDoc` only.

## Layers

One graph, one layout, toggleable overlays. A base view shows the happy path; each
overlay adds nodes and edges on top without disturbing what is already there.

Named layers, capped at four. Adding a fifth is a schema change, deliberately.

- `base` — the happy path, one unit of value end to end. Always visible.
- `edge` — failures, disputes, retries, nobody-responds paths.
- `business` — human actors, artifacts, external parties, manual handoffs.
- `build` — CI, eval sets, deployment. Operates on a different clock from runtime.

A node or edge carries `layers: ["base"]` by default. Technical is not a layer; it
is what remains when the others are toggled off.

**Layout is computed against the union of all layers, once.** Toggling a layer
changes visibility only — never position. If ELK re-ran per visible combination,
every node would move when an overlay came on and the reader would lose the map
they had learned. Hidden nodes keep their coordinates and leave gaps in the base
view. The gaps are honest: they are where the complexity sits.

This is the reason the no-stored-positions rule matters in practice. Positions are
derived from the full graph at render time, so every combination of overlays is
consistent by construction.

## Output

Two outputs from one layout pass.

**Primary: a single self-contained HTML file.** Inline SVG for the graph, a checkbox
bar for layers, a small script that flips visibility on tagged elements. No build
step, no server, no dependencies. Opens by double-click, survives being emailed.
Because layout is precomputed against the union, the script never lays anything out.
Tours live here too, since a tour is inherently stepped.

Checkboxes rather than preset views. Presets encode a guess about who is reading; a
managing agent may want business and edge cases with no infrastructure at all, and
nobody would have thought to offer that combination.

**Secondary: static SVG export per view.** The user picks a combination and exports
that frame. Coordinates are identical across exports, so a base SVG and a
base-plus-business SVG overlay exactly — a deck can build the map up across slides.

Rejected: SVG with embedded script. Single file and still an image, so it looks like
the best of both, but the script only runs when the file is opened directly in a
browser. Embedded via `<img>`, pasted into a document, or printed, it silently
becomes a static image that looks like it should be interactive. Two honest formats
beat one that loses half its function depending on context.

### Edges at a visibility boundary

*Revised 2026-09-15 by the owner.* An edge is visible only when **both** of its
endpoints are visible. If either endpoint is hidden by the active layer filter, the
whole edge is hidden: line, arrowhead, hit area and labels. So is any handle left with
no visible edge, and group frames shrink to their visible members. Nodes still never
move.

This replaces the original **stub** rule, where an edge ended at a small marker in
empty space. On a real map those markers read as leftover debris. Discovery is kept
without them: a node's details card lists every connection, marking those to hidden
nodes "(hidden)".

The other half of the original rule stands. An edge is never bridged to the next
visible node: that would imply a direct link which does not exist, which is the one
thing a documentation tool must never do.

## Tours

A static map answers "what is this". A tour answers "how does this work", which is
what a client or a new hire actually needs. Borrowed from cc-wf-studio, where it
earned its place.

An ordered list of steps, each spotlighting one or more nodes with a short
narration. The renderer dims everything outside the spotlight. Same graph, no extra
authoring model.

```jsonc
"tour": [
  {
    "order": 1,
    "title": "How a job starts",
    "description": "The main contractor assigns work and the slot is published.",
    "nodeIds": ["mc", "cal", "cust"]
  }
]
```

Optional. Generated on request, not by default. Most valuable on the business
layer, where the audience is not technical.

## Prior art: cc-wf-studio

Reviewed at `github.com/breaking-brake/cc-wf-studio` (core, cli, mcp are MIT; the
VSCode extension is AGPL-3.0). Decision: do not build on their schema. Borrow the
design calls that were validated by a shipped tool.

**Borrowed**

- Grouping by `parentId` on the node rather than a membership list on the group.
  One level deep, same as this spec.
- `condition` lives on the connection, not on a branch node. They arrived at this
  independently; two designs landing there is reasonable evidence.
- Explicit validation rules with hard numeric caps, rejected loudly.
- Tours, above.
- One file as the single source of truth across every interface. Their
  `workflow.json` drives a canvas, a CLI and an MCP server. Same principle here.

**Rejected, and why**

- Their `BaseNode` stores `position: {x, y}`. The file is a canvas document that
  records where a human placed each node. This spec computes position at render
  time and never stores it. Incompatible at the root.
- `NodeType` is a closed enum of fourteen agent-orchestration primitives
  (`subAgent`, `skill`, `mcp`, `codex`, `ifElse`, `branchSession`, ...). Each
  carries executable meaning because the file compiles to a runnable agent
  command. Nothing in it can mean "Postgres", "managing agent" or "signed PDF".
- Their core services are agent-skill export and prompt generation. Dead weight
  for this use case.

**Calibration taken from them**

Their cap is 100 nodes per workflow, on a canvas where a human places each one.
That suggests the ~25 density budget in this spec is conservative for an
auto-laid-out graph. Treat 25 as the trigger to *offer* the overview tier, not a
hard ceiling, and raise it once ELK output is measured.

## Build order

1. Renderer against hand-written JSON. No LLM. Prove it holds at real scale.
2. ELK wiring with container nesting and orthogonal edge routing.
3. Icon resolution layer with the three-tier fallback.
4. Extraction: prose to JSON. The easy half, once 1 to 3 hold.
