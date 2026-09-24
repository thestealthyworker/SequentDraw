# Workflow Designer — handover

> Carried over from the claude.ai web discussion. "Workflow Designer" was the working
> name; the tool is now **SequentDraw**.

Prototype is working. This document is the brief for turning it into a repo and a
Claude plugin. Read [`SPEC.md`](SPEC.md) (originally `workflow-designer-spec.md`) first for the product design; this
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
*Superseded 2026-09-15:* the owner chose n8n style, flowing left to right. The n8n
renderer keeps `RIGHT` readable with a pan/zoom viewer, a feedback-arc-set pass for
direction, and obstacle-aware routing. See `docs/design/n8n-visual-style.md`.

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

*These describe the legacy prototype renderer (`src/render-html.js`). In the n8n
renderer, edges crossing nodes are measured at zero and compaction is gone; see
`docs/design/n8n-visual-style.md`.*

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
  training data. Suggestions should be constrained by what is already in the graph,
  not by what is common. They are workflow improvements only: SequentDraw does not
  reason about budget, price, cost or region, and the user decides what fits (owner,
  2026-09-17).

Order matters: build gap detection first. A tool that guesses at what you should add
before it can reliably describe what you have will not be trusted.

### Decisions (2026-09-15)

The owner asked for the engine to recommend which tools best fit the business design
a map describes. That request is this suggestion agent. Settled:

- **Suggest, the user accepts.** Recommended tools enter only as `suggested` nodes
  with a rationale. They are never written in as `confirmed`.
- **The pool is n8n's integration catalogue.** Every suggestion maps to something
  buildable as an n8n workflow, consistent with the n8n visual style
  (`docs/design/n8n-visual-style.md`). Integration names are referenced as facts; no
  n8n source or assets are copied.
- **It is built after gap detection**, as ordered below.
- **In plugin form, the host AI reasons.** Claude, Codex or another agent proposes
  the suggestions. The engine supplies the catalogue and the constraints, and
  validates each suggestion: a rationale is present and cites nodes that exist in the
  graph, the pick is from the catalogue, and there are at most five per map. This
  keeps the engine usable from the CLI, or any future adapter, without an embedded model.

## Recommended build order

Revised 2026-09-15 for the n8n visual style.

1. n8n-style renderer (`docs/design/n8n-visual-style.md`), left-to-right, as a pure
   core with a CLI adapter. **Done (PR #8).**

Each step from here ships its Claude Code / Codex skill and eval cases in the same
PR (`docs/design/skills-and-plugin.md`). The owner-defined skills are `git-map`,
`business-map`, `eval-build`, `grill-build`, `gitrepo-suggest` and `doc-map`. The
plugin scaffold arrives with the first of them, `git-map`.

2. Text notes: n8n-style sticky notes from the IR `notes` array, placed by the engine
   (design in the same doc). The owner requested this on 2026-09-15. **Done (PR #11).**
3. Validate the JSON schema on input, including notes. Fail loudly on the invariants
   listed in the spec, report every error at once, and publish a JSON Schema.
   **Done (PR #12).**
3a. Details cards: optional node and edge descriptions shown on hover, tap or keyboard,
    with derived connections, plus gold "Consider:" notes. Requested by the owner after
    reviewing the maps. Also fixes layer toggles so edges, handles and frames leave no
    leftovers. **Done (details-cards PR).**
3b. Documentation export: a static SVG with inline captions for screenshots and docs,
    because hover cannot appear in an image. Its skill `doc-map` ships with step 5.
    **Done (PR #17).**
3c. Layout performance: dense cyclic graphs within the validation caps (100 nodes, 500
    edges) could stall rendering for over 90 seconds, a denial of service for the future
    API and MCP surfaces. It is fixed and bounded before any skill ships.
4. Promote `check.js` into automated tests. Assert zero node overlaps, edge
   attachment within tolerance, zero label collisions, no note overlapping a node.
   These are the regression tests that make everything after this safe.
5. Build extraction, Mode A first. It is the easier half and produces a testable
   artifact.
6. Build Mode B as a question flow, with gap rendering.
7. Suggestion agent (tool recommendations from n8n integrations), after gap detection
   is trustworthy. **Shipped in the step 7 PR:** the `business-map` suggestion step,
   `eval-build` and `grill-build` (`docs/design/suggestion-agent.md`).
7a. Correction mode, added by the owner (2026-09-15) after M2. In the viewer, users
    correct wrongly mapped nodes by meaning, not position: reattach or delete a
    connection, move a node to another group or layer, change its kind, edit sticky
    notes. **Save corrected JSON** downloads the updated document with a change list,
    and the engine re-renders it with a fresh layout. There is no free dragging and no
    stored positions, since stored positions would break computed layout, layer toggles
    and the documentation export. Conversational correction ("move Stripe into
    Payment") is available earlier, through the skills from `git-map` on.
    Designed in `docs/design/correction-mode.md`.
7c. Export from the viewer, added by the owner (2026-09-20). **Export SVG** and **PNG**
    buttons that write what is on screen — the reader's layers, their Notes setting, the
    visible content cropped — with no dependency and no network. Distinct from `doc-map`,
    which re-lays-out the map with full captions for a figure nobody can hover. Design in
    `docs/design/n8n-visual-style.md`, "Export from the viewer".
7b. GitHub repository search with licence verification → `gitrepo-suggest`. For the
    map's weakest or most custom-built nodes, search GitHub for relevant MIT-licensed
    repositories, verify each licence through the GitHub licence API (SPDX `MIT`
    exactly), check activity and fit, and attach candidates as sticky notes linked to
    the node. Numbered `7b` rather than renumbering the steps after it, so existing
    references to steps 8, 8a and 9 keep meaning what they meant. Designed in
    `docs/design/gitrepo-suggest.md`; shipped as `sequentdraw licences`,
    `check --repos` and the `gitrepo-suggest` skill.
8. Tours, then the MCP server, then `skills install`. **The HTTP API is deferred**
   (owner, 2026-09-24): every caller designed for is served by skills, the CLI or MCP,
   and "anything else" was a guess about a future caller. It is also the only surface
   that would be a network service, with the input limits, auth and rate limiting that
   brings. The engine is pure functions behind thin adapters, so an HTTP adapter can land
   whenever a real caller needs one without anything built now having to change.
8a. **Before the first npm publish:** vendor the stack-analyser detection rules SequentDraw
    uses into `src/scan/rules/`, keeping the MIT notice, and drop the dependency. npm
    ignores a dependency's `overrides`, so downstream installs would otherwise inherit its
    transitive advisories (see `docs/design/git-map.md`, "Supply chain").
8b. **Clear the tree, immediately before the M3 gate** (added by the owner, 2026-09-20).
    Every open pull request is merged or closed, and every open issue is fixed or
    explicitly deferred by the owner, so the final gate reviews a finished product
    rather than a work in progress. A gate report that spends its findings on things
    already logged tells the owner nothing they do not know, and each round costs a
    full CTO run. Deferred issues are labelled as such and named in the M3 brief, so
    the CTO does not re-raise them.
9. **Internal cleanup, after the M3 gate passes:** remove the CTO agent, the review
   reports and the gate process (see `CLAUDE.md`). They are internal checks, not part
   of the product. The work is not complete until this is merged.

**Milestone gates.** The CTO agent (`sequentdraw-cto`, on Fable) reviews `main` at
three points, and only there, each after the lead developer has merged the milestone:
**M1** once extraction Mode A and `git-map` are in; **M2** once the suggestion agent
is in (`business-map` with suggestions, `eval-build`, `grill-build`); and **M3** when
the build order is complete. The procedure is in `CLAUDE.md`.

The original plan had M3 re-test against the unrecovered prototype files (`check.js`,
`layout.js`, `stampedid-workflow.json`). The owner released that on 2026-09-24: the
lead developer re-tests the product end to end itself, against the repository's own
fixtures and examples, which have since grown to cover everything those files did —
`check.js`'s measurements are the automated layout tests from step 4.

The "two known defects" in the old build order (edges crossing containers, label overlaps)
are re-measured against the n8n renderer rather than fixed in the legacy one.

## Validation material

`examples/medusa-return-flow.json` — 40 nodes, 5 groups, 44 edges, 4 layers,
hand-written from Medusa's published RMA documentation. Use as the layout regression
fixture; it is deliberately harder than a typical input (15 of 44 edges cross
layers).

`examples/stampedid-workflow.json` — 15 nodes, smaller, real project. Better for
testing extraction accuracy later, since ground truth is known.
