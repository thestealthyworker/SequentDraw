# Design: suggestion agent, `eval-build` and `grill-build` (build step 7)

Status: **decided** · 2026-09-17. Built: the engine rules (#47, #48, #49) and, in the
step 7 PR, the `business-map` suggestion step, `eval-build`, `grill-build` and the 13
evals of §5. Where the body below says "proposed", the decisions block overrides it.

Step 7 is the suggestion agent: recommending tools from n8n's integration catalogue
for the business a map describes (`docs/HANDOVER.md:238-239`). It closes the M2 gate,
which is `business-map` with suggestions, plus `eval-build` and `grill-build`
(`docs/HANDOVER.md:265-267`; `docs/design/skills-and-plugin.md:240`). This document
designs all three skills and the engine-side check that keeps suggestions honest.

**The owner answered the blocking questions on 2026-09-17.** These override anything
below that says otherwise; the original analysis is kept in §2 and §6 for the record.

- **A. The catalogue: SequentDraw writes its own list.** Integration names, a one-line
  description written by SequentDraw, SequentDraw's own categories, and icons only from
  Simple Icons (already a dependency). Nothing is taken from n8n's source, node
  definitions, descriptions, node type ids or icons. Each name is checked to exist as an
  n8n integration, since a product's name is a public fact. The reason this matters
  even though the owner does not plan to commercialise SequentDraw: the repository is
  public and declared MIT, and MIT lets anyone who installs it use it commercially, so
  nothing under n8n's Sustainable Use License can be republished in it.
- **B. Budget and region: dropped.** Suggestions are workflow improvements only.
  SequentDraw does not reason about budget, price, cost, financial fit or region; the
  user decides what fits their business. The "budget and region fit beat popularity"
  rule is withdrawn. Popularity bias is still guarded against by the graph constraint:
  a suggestion must answer something the map shows.
- **Completeness ignores suggested nodes** (§1, question 3). A suggestion never changes
  what the map says about the real system. Being fixed in its own PR.
- **`cites` and `integration`: both added as node fields** (§3, question 4). `cites` is
  1–10 unique ids of existing nodes that are not themselves suggested; it is required on
  a `suggested` node and forbidden on every other status, like `rationale`.
  `integration` is a `src/catalogue` id; it is required on a `suggested` node and also
  allowed on `confirmed` and `open` nodes, because accepting a suggestion drops
  `rationale` and `cites` but keeps `integration`. At most five `suggested` nodes per
  document. All of this is enforced in `validateDoc`; the codes are listed under
  question 4.

Lead developer defaults the owner did not object to: at most five suggestions and zero
is acceptable, target three (question 5); declined suggestions are not remembered across
conversations (6); `grill-build` replacements cite the node they replace (7); "suggest
integrations for this map" routes to `eval-build` (8); an accepted suggestion becomes
`source: "user"` (10); `grill-build` may question whether the business needs n8n at
all (11). Still open: `eval-build` getting no engine gap findings on base-only maps (9).

**Lead developer decisions for the step 7 PR (2026-09-17).** These override §2, §4 and
§5 where they differ.

- **Both review skills run inline**, never `context: fork`.
- **`grill-build` axes: lock-in, single points of failure, scaling, operational burden,
  and whether the business needs an automation platform at all.** There is no cost
  axis: the owner withdrew budget and cost reasoning (B), so the §4 bullet on the cost
  axis is withdrawn too. Harsh means specific and anchored to nodes, never louder.
- **`grill-build` alternatives** are a suggested node that `cites` the node it would
  replace, wired beside it with a dashed edge, plus one gold "Consider:" note attached
  to both stating the trade-off. No `replaces` field (question 7 decided).
- **`eval-build` is balanced and suggests additions only**, never replacements.
- **"Suggest integrations for this map"** with a map and no review asked routes to
  `eval-build` (question 8 decided as the owner-accepted default); the §4 boundaries
  table is corrected.
- **Base-only maps (question 9):** the engine reports no completeness gaps on a map
  without a `business` layer. Both review skills say their findings are their own
  judgement there and never cite "the engine found no gaps" as evidence of soundness.
  Whether rules 1, 2 and 4 should run on base-only maps stays open.
- **At most five notes written per review**, trade-off notes included; the cap of five
  suggested nodes counts suggestions already in the map. Review notes carry an id
  prefix, `n_review_` or `n_grill_`, like `q_` and `s_`.
- **Documents reach the CLI through `printf`, not a heredoc.** The CI traces of the
  last eval run show that a `Bash(node:*)` grant refused every
  `node .../bin/sequentdraw ... - <<'EOF'` whose body was a JSON object, and accepted
  `printf '%s' '<json>' | node .../bin/sequentdraw check -`. The skills therefore pipe
  each document from `printf`, write apostrophes inside it as `\u0027`, save it with
  `check - --emit-open <folder>/<name>.json` (the CLI writes every file and creates
  the folder), and render from that file. `--emit-open` no longer adds a second
  rule-6a note when the copy already carries one, so a document can be saved more than
  once.
- **Existing maps are changed by patch, never re-typed (PR #50, round 2).** Eval run
  35176295107 showed the balanced review re-typing the 23KB Medusa map into one
  `printf` string. The map's own apostrophes broke the quoting, the command was refused,
  and the run timed out. `check <map.json> --merge <patch|->` now applies a small patch
  (add nodes, edges, notes; remove nodes with their edges, edges by from/to, notes), and
  `eval-build` and `grill-build` use only that form against an existing map.
  `business-map` pipes the whole document once, for the freshly interviewed map, then
  patches `gaps.json` for suggestions, accepts and declines. Patches are written with no
  apostrophes or backticks.
- **Suggestions happen before rendering, and only when wanted.** `business-map` offers
  once; a user who declines, or who asked not to be asked anything and did not ask for
  suggestions, gets the map with no catalogue read.
- **Evals (§5):** as named, with runs 2 throughout. The `llm` rubrics grade grounding and
  trade-offs, not cost. Every regex is written against captured CLI output and tested
  against the real CI trace of the open-nodes case and against the skill text, which a
  trace also contains.

Decisions already made by the owner, written up here and not reopened:

1. **Suggest, the user accepts.** Recommended tools enter the map only as
   `status: "suggested"` nodes with a rationale. They are never written in as
   `confirmed` (`docs/HANDOVER.md:192-193`; `docs/design/skills-and-plugin.md:77`).
2. **The pool is n8n's integration catalogue.** Every suggestion maps to something
   that can be built as an n8n workflow. Integration names are referenced as facts,
   and no n8n source or assets are copied (`docs/HANDOVER.md:194-197`). *How* the
   catalogue is obtained is not decided (question A).
3. **The host AI reasons, and the engine validates.** Claude, Codex or another agent
   proposes the suggestions. The engine supplies the catalogue and the constraints, and
   it checks that each suggestion has a rationale, that the rationale cites nodes that
   exist in the graph, that the pick is from the catalogue, and that there are at most
   five per map. This keeps the engine usable without an embedded model, from the CLI or any
   future adapter (an HTTP API was planned here and is now deferred; see
   `docs/HANDOVER.md` step 8).
4. **Three to five suggestions per map, five at most** (`docs/HANDOVER.md:176-178`).
5. **The rationale is grounded in the map.** "Most pipelines have a queue" is not a
   rationale. "Three long-running steps run synchronously" is
   (`docs/HANDOVER.md:171-173`; `docs/design/skills-and-plugin.md:78-79`).
6. **Suggestions never enter the graph silently.** Accepting one flips it to
   `confirmed`, and only the user can do that. Declining removes it. Until then it is
   drawn distinctly (`docs/HANDOVER.md:174-175`).
7. **~~Budget and region fit beat popularity.~~ Withdrawn by the owner, 2026-09-17.**
   Suggestions are workflow improvements only; no budget, price, cost or region
   reasoning, and the user decides what fits.
8. **Gap detection comes first** (`docs/HANDOVER.md:184-185`, `198`). It shipped in
   #39 and #41.
9. **`grill-build` fires only on an explicit ask**: grill, harsh, brutal, stress-test,
   tear apart. "Review my architecture" goes to `eval-build`
   (`docs/design/skills-and-plugin.md:93`). The two skills get dedicated confusion
   evals in both directions (`docs/design/skills-and-plugin.md:182-183`).
10. **`business-map` runs inline, never as `context: fork`**
    (`docs/design/skills-and-plugin.md:101-103`). Adding a suggestion step does not
    change that.

### How claims are marked

`business-map.md` stated three things about engine behaviour that turned out to be
false once the engine existed (#40, #42). To avoid repeating that, every claim here
about behaviour carries one of three tags:

- **Built**: exists on `main` at `661c1e4`. Cited to file and line.
- **Measured**: observed by running the code on `main` at `661c1e4`. The measurements
  in §1 called `validateDoc()` and `checkCompleteness()` directly from a scratch
  script outside the repository. `sequentdraw check` calls exactly these two functions
  (`src/cli/check.js:186`, `207`). The script is not committed, since this PR is
  docs-only. The implementing PR turns each measurement into a test.
- **Proposed**: this document's design. Nothing like it exists in the code.

Anything that is none of these is marked **unverified**.

## Principle: a suggestion is an opinion drawn beside the facts

A SequentDraw map records what is true of the user's system. `open` nodes record what
is not yet known (`docs/SPEC.md:241-244`). A `suggested` node is a third kind of thing:
it does not exist in the user's business. It is the tool's opinion, drawn in the map
so the user can judge it in context, not argued for in prose
(`docs/HANDOVER.md:147-148`).

That leads to one rule, and most of the design follows from it. **A suggestion must
never change what the map says about the user's actual system.** It cannot close a
gap, it cannot create one, and it cannot count towards "complete". §1 shows that the
engine does not follow this rule today.

## What exists, and what does not

| Piece | State | Where |
|---|---|---|
| `status: "suggested"` in the schema enum | **Built** | `schema/sequentdraw.schema.json:147-152`; `src/n8n/validate.js:32` |
| `rationale`, at most 500 characters, required on `suggested` and forbidden on every other node | **Built** | `schema/sequentdraw.schema.json:166-171`, `195-207`; `src/n8n/validate.js:44`, `571-587` (`rationale-required`, `rationale-not-allowed`); tests at `tests/n8n-validate.test.js:394-454` |
| `source: "model"` in the enum | **Built** | `src/n8n/validate.js:33`; `schema/sequentdraw.schema.json:153-158` |
| Rendering: purple 2px border, "+" badge | **Built** | `src/n8n/constants.js:52`; `src/n8n/render-svg.js:41-48`, `64-74`, `94` |
| Details card: "Why suggested:" line and a purple status badge | **Built** | `src/n8n/card-data.js:94`; `src/n8n/render-shell.js:100`, `546-550` |
| Gap detection: six completeness rules, gated on the `business` layer, `--emit-open` | **Built** (#39) | `src/gaps/completeness.js:153-441`; `src/cli/check.js:207-249` |
| Any suggestion agent or suggestion step in a skill | **Built in the step 7 PR** (was: `business-map` refused, "Not shipped yet") | `skills/business-map/SKILL.md`, step 4 |
| An n8n integration catalogue of any kind | **Not built** | — |
| Accept or decline, in the viewer or in conversation | **Not built** | — |
| A way for a rationale to cite a node, other than free text | **Not built.** `rationale` is a plain string | `src/n8n/validate.js:571` |
| A field naming which catalogue entry a node is | **Not built.** An unknown field is an error | `src/n8n/validate.js:107-121` (`NODE_KEYS`); measured in §1 |
| Any suggested state on edges | **Not built.** Edges carry no `status` | `src/n8n/validate.js:123` (`EDGE_KEYS`) |
| `eval-build`, `grill-build` | **Built in the step 7 PR** (was: listed as not shipped in the routing note) | `skills/eval-build/`, `skills/grill-build/`; `hooks/session-start.js` |

Grepping `src/` for `suggested` finds only the node styling, the card and the
validator rows above (**measured**). Nothing else in the engine treats a suggested node
differently from a confirmed one, and that includes the completeness rules.

## 1. How suggested nodes interact with what already exists

This section comes first because the rest of the design depends on it. The completeness
rules were written and measured before suggestions existed. `src/gaps/completeness.js`
gives `open` nodes special treatment (`isOpen`, `completeness.js:95-97`, used at `254`
and `389`) and gives `suggested` nodes none.

### Measured on `main` (`661c1e4`)

The base document is a small business map with every rule satisfied: customer →
enquiry form (`service`) → send quote (`manual`) → invoice (`artifact`) → customer,
plus a dashed `no reply` branch to an `edge`-layer step owned by a `human`. On its own it
validates and reports no gaps. Each row below changes one thing.

| # | Change | `validateDoc` | `checkCompleteness` |
|---|---|---|---|
| A1 | Remove the invoice's outgoing edge | valid | `artifact-no-recipient` |
| A2 | As A1, then add a suggested `service` "Gmail" wired invoice → Gmail → customer | valid | **nothing** |
| B | Add a suggested `service` on `business`, wired send quote → it, with no outgoing edge | valid | `flow-dead-end` on the **suggested** node |
| C | Add a suggested `service` on `base`, wired it → send quote, with no incoming edge | valid | `input-no-source-actor` on the **suggested** node |
| D1 | Remove the `edge`-layer nodes | valid | `unhappy-paths-missing` |
| D2 | As D1, then add a suggested `service` on `edge` | valid | **nothing** |
| E | Add a suggested node with no edges | `orphan-node` | `input-no-source-actor` |
| H | Insert a suggested `service` between two `service` nodes, with `source: "user"` and no description on the edges | valid | `handoff-undrawn` |
| H2 | As H, with `source: "model"` on the edges | valid | nothing |
| G | A base-only map (no `business` layer) with a suggested node | valid | nothing (the gate, `completeness.js:193-196`) |
| I | A suggested node with `source: "user"` | valid | nothing |
| J | A suggested node with an extra field `integration: "stripe"` | `unknown-field` at `/nodes/6/integration` | nothing |
| K | A suggested node with `icon: "stripe"` | valid | nothing |

What this shows:

1. **A suggestion can hide a gap (A2, D2).** An `open` node satisfies a rule because it
   stands where an owner or recipient should be, and that is intended
   (`completeness.js:12-15`). A `suggested` node standing in the same place satisfies
   the rule in the same way, because the rules only count degree. So "nothing in the
   map receives the invoice" goes quiet as soon as the tool *proposes* an email
   integration, even though the user has accepted nothing. Rule 6a behaves the same:
   one suggested node on `edge` is enough to silence "nothing goes wrong in this map"
   (`completeness.js:419`). This breaks the principle above, and decision 6 too.
2. **A suggestion can create a gap (B, C, H).** Suggested nodes are subjects. With
   `--emit-open`, B would draw an open question "What comes out of Google Sheets?"
   about a tool the user does not have.
3. **A suggestion needs at least one edge (E).** An unwired suggested node is an
   `orphan-node` error unless it is alone in its group (`src/n8n/validate.js:652-684`).
   Every suggestion is therefore anchored to the graph by an edge. That is also the
   natural way to show *where* it would go.
4. **Nothing ties `suggested` to `source: "model"` (I).** A user-sourced suggestion
   validates.
5. **A catalogue reference needs a schema change (J).** Unknown node fields are
   rejected, so the engine cannot check "drawn from the catalogue" unless a new field
   is added or an existing field (`label`, `icon`) is overloaded.
6. **`icon` is already legal on a suggested node (K)**, and it resolves against Simple
   Icons (CC0, `CREDITS.md:11`; `docs/SPEC.md:129-136`), not against n8n's assets.
7. **`eval-build` on a `git-map` map gets no gap findings from the engine (G).** Every
   rule gates on a `business` layer (`docs/design/business-map.md:184-206`). §4 deals
   with this.

**Checked:** each row above. **Not checked:** rendering. Whether an edge into a
suggested node is drawn differently from any other edge was not measured. Edges have
no `status` (`src/n8n/validate.js:123`), and the grep above found no edge code that
reads an endpoint's status, so the expectation is that it is not drawn differently.
That expectation is **unverified** until someone renders it.

### Proposed: completeness ignores suggestions

`checkCompleteness` runs on the document **with every `suggested` node, and every edge
touching one, removed**. A suggestion is then neither a subject nor something that
satisfies a rule. The report describes the user's actual system both before and after
suggestions are added. So A2 still reports `artifact-no-recipient`, D2 still reports
`unhappy-paths-missing`, and B, C and H report nothing.

Consequences, all **proposed**:

- **The gap and the suggestion appear side by side.** In A2 the copy written by
  `--emit-open` carries both an open "Who receives this?" node and the suggested Gmail
  node. That is the honest picture: the question is still open, and one possible
  answer has been suggested.
- **The `--emit-open` copy keeps the suggested nodes untouched.** `buildOpenDocument`
  already copies the parsed input verbatim (`completeness.js:448-483`). Only the
  analysis ignores them.
- **Removing a suggestion's edges can expose a real gap on a confirmed node.** That is
  correct. The gap was there before the suggestion was drawn.
- **Rule-6a note ids and `q_` ids stay unchanged.** Suggested ids stay in `takenIds`
  (`completeness.js:221-229`), so an emitted id never collides with one.

The alternative is to treat a suggestion like an `open` node: it satisfies rules but is
never a subject. That is simpler, but it keeps problem 1, so a proposal would count
towards completeness. It is listed in §6.

## 2. The suggestion step in `business-map`

### Where it sits

The suggestion step runs **after** the interview and gap emission, **before** rendering.
It works on the copy that `--emit-open` wrote. That is the order decision 8 requires,
and it means suggestions are made against a map whose gaps are already drawn.

```
interview ─► map.json ─► check --emit-open gaps.json ─► [suggestion step] ─► suggested.json
                                                            │
                                   catalogue ◄──────────────┤  host AI reads the map,
                                   (source: question A)     │  picks 3–5 from the pool
                                                            ▼
                                        check suggested.json ─► render ─► publish
                                                            │
                                        "accept" / "decline" in conversation ─► republish
```

The step is **proposed** throughout.

1. **Never pause for it.** *Decided 2026-09-17 (lead developer), after a CI eval run
   where the skill stopped before rendering to ask and never produced the map.* The
   step runs before rendering only when the user already asked for suggestions.
   Otherwise the map is rendered and published first, and the closing message offers
   once: "I can also suggest up to five n8n integrations that fit this map -- want
   them?" A later yes runs the step against the saved map. Suggestions are never the
   price of getting a map.
2. **Read the pool.** The host gets the catalogue from the engine (see "Engine
   surface" below). It does not draw on its own memory of which tools exist. That rule
   is what makes "drawn from the catalogue" checkable, and it is the only defence
   against popularity bias this design can actually enforce (see "Budget and region").
3. **Anchor each suggestion to what the user said.** A suggestion is admissible only
   if it attaches to something the user already said. Proposed anchors, in order of
   preference:
   - **An open node.** The interview left "Who chases an unanswered quote?" open, so a
     reminder integration may be suggested *beside* it. The open node stays open,
     because a suggestion does not answer a question the user has not answered.
   - **A `manual` step the user described as done by hand** (interview question 8,
     `docs/design/business-map.md:90`), where a catalogue integration could carry the
     work.
   - **A system-to-system edge the user described as re-keyed by a person**
     (the rule-3 territory, `docs/design/business-map.md:171`).
   - **A tool the user already confirmed.** Prefer integrations for tools already in
     the map. This is the graph-constrained reading of the popularity-bias rule in
     `docs/HANDOVER.md:179-182`: "constrained by what is already in the graph, not by
     what is common".
4. **Write each suggestion** as a node: `status: "suggested"`, `source: "model"`,
   `rationale` of at most 500 characters naming the anchor in the user's words, a
   `kind` (normally `service`), the anchor's `layers` and `parentId`, an `icon` only
   when Simple Icons has the brand (never n8n's icon), and at least one edge to its
   anchor (measurement E). The id is prefixed `s_`, matching the example in
   `docs/HANDOVER.md:160`, the same way the skill matches `q_` for open nodes. The
   citation and catalogue fields are in §3.
5. **Check**, render and publish as in `business-map` steps 5 and 6
   (`skills/business-map/SKILL.md:117-140`).
6. **Accept and decline are corrections** (see "Accept and decline").

### How many, and when to offer fewer

The cap is five (decision 4). The step aims for **three** and goes above that only when
the map has more than three distinct anchors. It offers **fewer than three, or none**,
when the catalogue has nothing that fits an anchor. A padded suggestion is exactly the
"map where half the nodes are the tool's opinion" `docs/HANDOVER.md:176-178` warns
about. HANDOVER's "three to five" reads as a range, not a quota, and that reading is
**proposed**. §6 asks whether zero suggestions is an acceptable outcome.

### Accept and decline

Both happen **in conversation**, and both are **proposed**. Buttons in the viewer
belong to step 7a, correction mode (`docs/HANDOVER.md:240-247`), which comes after M2.

- **Accept** ("yes, use Stripe"): the node loses `status` (or it becomes
  `"confirmed"`) and loses `rationale`, which is forbidden on anything that is not
  suggested (`src/n8n/validate.js:581-587`). Its `source` becomes `"user"`, because the
  user has now asserted it. Its id keeps the `s_` prefix, because ids are referenced by
  notes and tours and renaming buys nothing. Then re-run `check`, which may now report
  gaps on the accepted node itself, since it is no longer ignored. Then republish to the
  same artifact. If an open node sat beside the suggestion, accepting does not close
  it. The skill asks the question again, because the answer ("who chases?") may still be
  a person.
- **Decline** ("no, not Stripe"): remove the node and every edge touching it, re-run
  `check` and republish. Removing a suggestion never orphans a confirmed node: a
  suggestion only reaches the graph through its own edges, and the confirmed node had
  its own edges before the suggestion was added.
- **Declined suggestions are not remembered** in the map document. There is no field
  for them, and a note per declined suggestion would use up the 20-note cap
  (`src/n8n/validate.js:77`). Within one conversation the skill does not propose them
  again. Across conversations it may. Listed in §6.

### Budget and region: where the information comes from

> **Superseded, 2026-09-17.** The owner withdrew the budget-and-region rule: suggestions
> are workflow improvements only, and the user decides what fits. This section is kept as
> the record of why the rule could not have been enforced.

**Plainly: it does not currently exist anywhere in SequentDraw.**

- **The interview never asks.** Its eight questions cover the unit of value, the
  trigger, the first decision, the work, the handover, payment, unhappy paths and
  systems (`docs/design/business-map.md:81-90`; `skills/business-map/references/interview.md`).
  None of them asks about budget, spending limits, country, region, currency,
  headcount or data-residency constraints. The only mention of "budget" in either file
  is the three-unhappy-path limit (`docs/design/business-map.md:89`;
  `skills/business-map/references/interview.md:104`). **Checked** by reading both files
  and grepping them for budget, region, country, currency, cost, price, size and staff.
- **The IR has nowhere to hold it.** The document's top-level keys are `$schema`,
  `title`, `groups`, `nodes`, `edges`, `notes` and `tour` (`src/n8n/validate.js:105`).
  A budget or region could go in a sticky note as prose, but no engine rule can read
  a note.
- **The one catalogue source measured carries popularity, not fit.** The public n8n
  endpoint in §6 question A returned entries with a `popularity` field and no field for
  price or region (**measured** on 2026-09-17 by fetching the endpoint through a summarising web tool, so only the first entries were seen and the field list is not exhaustive; see §6). A catalogue built from it would
  hand the host a ready-made popularity ranking, which is the bias the rule exists to
  prevent.
- **The host AI's own knowledge is where the bias comes from** (`docs/HANDOVER.md:179-182`).
  Pricing and regional availability from training data are also out of date by
  nature.

What this implies:

1. **The engine cannot check budget or region fit**, and this design does not claim it
   does. The engine checks can enforce: a cap, a citation, and membership of the
   catalogue (§3). None of them is about fit.
2. **As shipped today, the skill could only honour the rule by asking.** That means
   either a ninth interview question or a question inside the suggestion step: "Roughly
   what can you spend a month on tools, and which country do you operate in?" The
   interview was fixed at "about eight questions" (`docs/design/business-map.md:25-26`).
   Adding one question inside the suggestion step leaves the interview alone, and the
   question is only asked when suggestions were wanted.
3. **Even with an answer, the catalogue has nothing to match it against** unless it
   carries price bands and regional availability. SequentDraw would have to research
   and maintain those itself. They go stale, and a wrong price is worse than none.
4. **The enforceable part of the rule is the graph-constrained part**: anchors, and a
   preference for tools already in the map (step 3 above). That is a real guard against
   popularity, but it is not budget or region.

This document does not choose between these. It is question B in §6.

## 3. Engine-side suggestion validation

Decision 3 fixes what the engine checks. How it checks is **proposed** below, and two of
the checks need a schema change.

### Two new node fields (schema change)

| Field | On | Shape | Why |
|---|---|---|---|
| `cites` | `suggested` nodes only | array of 1–5 node ids | "cites nodes that exist in the graph" cannot be checked against free text. Matching node labels inside a 500-character prose rationale is fuzzy, and putting raw ids into the rationale would print them on the card (`src/n8n/render-shell.js:549`). A structured list can be cross-referenced exactly as `note.attachTo` is (`docs/SPEC.md:206`). |
| `integration` | `suggested` nodes; kept after acceptance (see below) | a catalogue key: a string matching the id pattern (`src/n8n/validate.js:27`) | "the pick is from the catalogue" needs the node to say *which* entry it is. `label` is display text the user may edit, and `icon` is a Simple Icons slug in a different namespace, which many integrations do not have. Measurement J shows no such field is accepted today. |

Each field touches `schema/sequentdraw.schema.json`, `src/n8n/validate.js` `NODE_KEYS`,
the schema parity test and `scripts/gen-schema-fixtures.js`. That is the same cost that
led the owner to defer edge-level `status` (`docs/design/business-map.md:458-471`), so
both fields are listed in §6 with a no-schema-change alternative.

Whether `integration` should stay on a node after it is accepted is open. Keeping it
lets `grill-build` later recognise the node as a catalogue tool. `cites` is dropped on
acceptance, like `rationale`.

### Structural rules, in `validateDoc` (every map, every surface)

These are cross-references that do not need the catalogue, so they belong beside the
existing `rationale-required` rule and apply to rendering too:

| Code | Test |
|---|---|
| `cites-required` | `status: "suggested"` and no non-empty `cites` |
| `cites-not-allowed` | `cites` on a node that is not suggested |
| `cites-unknown-node` | a `cites` entry that is not a declared node id |
| `cites-suggested-node` | a `cites` entry that is itself a suggested node. Suggestions cannot justify each other. |
| `integration-not-allowed` | depends on the open question above; if `integration` is dropped on acceptance, it is forbidden on non-suggested nodes |

### Product rules, in `check` (they need the catalogue)

These run in `sequentdraw check` whenever the document contains at least one
`suggested` node, whether or not a `business` layer exists. `eval-build` suggests on
base-only maps too.

| Code | Path | Test |
|---|---|---|
| `too-many-suggestions` | `/nodes` | more than five `suggested` nodes in the document, whichever skill added them |
| `suggestion-not-in-catalogue` | `/nodes/<i>/integration` | `integration` missing, or not a key in the catalogue |
| `suggestion-source-not-model` | `/nodes/<i>/source` | a suggested node whose `source` is not `"model"` (measurement I) |
| `suggestion-not-anchored` | `/nodes/<i>` | none of the suggestion's edges reaches a non-suggested node. A chain of suggestions hanging off one edge counts as one anchored suggestion plus unanchored ones. |

Report shape, bounds and exit codes are the same as the completeness rules:
`{ path, code, message }`, one `path  message` line per problem, the 100-error stop and
the array caps before per-item work (`src/n8n/validate.js:74-78`, `101`), and exit 1
when asked to report (`docs/design/business-map.md:271-276`).

**`--emit-open` does not fix suggestion problems.** A suggestion error is a structural
error for that flag's purposes: it is listed, the exit is 1, and nothing is written,
matching `docs/design/business-map.md:266-267`. The engine never deletes a suggestion
the host wrote. The host fixes it.

**What the engine does not check**, stated so no skill or grader assumes otherwise:
whether the rationale is *true*, whether the tool fits the budget or the region, and
whether the citation is the *right* one. Those are judgement calls. They are graded by
LLM rubric at most (`docs/design/skills-and-plugin.md:173`), and otherwise by hand.

### Engine surface for the host

| Surface | Contract (proposed) |
|---|---|
| `sequentdraw catalogue [--category <c>] [--json]` | Prints the pool the host must choose from: key, display name and category, in SequentDraw's own words. Its content, and whether it reads a bundled file, a cache or the network, is entirely question A. |
| `sequentdraw check <map.json> [...]` | Unchanged flags. Adds the suggestion rules above whenever a suggested node is present. |
| HTTP / MCP | The same two operations, later (`docs/design/skills-and-plugin.md:243`). No model runs server-side (decision 3). |

The catalogue is read-only reference data given to the host. The engine never ranks
it. If the catalogue source carries a popularity signal, the engine drops that signal
before the host ever sees it.

## 4. `eval-build` and `grill-build`

Both skills share inputs, pipeline and output rules. They differ in stance, trigger and
what counts as a finding. The table rows in `docs/design/skills-and-plugin.md:45-46`
are the brief. Everything below is **proposed** unless cited.

### Shared pipeline

1. **Find the map.** Use a map in the conversation or one the user names. If there is
   none and the user points at a repository, run `git-map` first
   (`docs/design/skills-and-plugin.md:45`). If there is none and the subject is a
   business, offer `business-map` first. Neither skill invents structure.
2. **Validate**: `<sequentdraw> validate map.json`.
3. **Gap findings**: `<sequentdraw> check map.json --emit-open review.json`. **Only a
   map with a `business` layer produces completeness gaps** (measurement G;
   `src/gaps/completeness.js:193-196`). On a `git-map` map the engine reports nothing
   here, so every finding on a technical map is the host's own judgement. The skill must
   not claim "the engine found no gaps" as evidence that the architecture is sound. It
   only means the rules do not apply to that map. Whether rules 1, 2 and 4 should run
   on base-only maps is still open question 2 of `business-map.md`
   (`docs/design/business-map.md:472-488`), and it matters more once `eval-build`
   exists.
4. **Review findings.** Each finding is either:
   - an **open node** with a `prompt`, when it is a question about the user's own system
     ("Nothing retries when the payment webhook fails. Who notices?"), or
   - a **gold "Consider:" sticky note** attached to the node or nodes it concerns
     (`docs/HANDOVER.md:222-225`), when it is an observation rather than a missing
     piece.
   The note cap is 20 per document (`src/n8n/validate.js:77`), shared with notes the map
   already has, so a review writes **at most five notes** and puts the rest in the
   written summary.
5. **Suggestions in review mode**: as in §2, with the cap counting suggestions already
   in the map. If `business-map` left four, `eval-build` may add one, or may ask which
   pending suggestion to drop.
6. **Check** the result (suggestion rules plus completeness), **render**, **publish** a
   private artifact plus the local copy (`docs/design/skills-and-plugin.md:66-76`).
7. **Written summary**, short: the three most important findings, the suggestions and
   what each is anchored to, and what the engine could not check.

**Inline or fork: proposed inline** for both. A review ends with suggestions the user
accepts or declines, which is a conversation. `git-map` may fork because it needs
nothing from the user (`docs/design/skills-and-plugin.md:101-103`). When `eval-build`
runs `git-map` first, that sub-step may still fork.

### `eval-build`: balanced

- **Stance**: what works, what is missing, what is fragile, in proportion. Each finding
  names what already works where that is relevant. A review with nothing positive in it
  is a grill.
- **Findings**: gaps and fragility, as open nodes and notes.
- **Suggestions**: additions that fill a finding (the §2 anchors). **Not replacements.**
  Swapping a working tool is `grill-build`'s territory.
- **Description draft** (to be tuned by trigger evals, ≤ 1,536 characters with
  `when_to_use`, `tests/skill-description-length.test.js:15`):

  > Review an existing SequentDraw architecture or business map in a balanced way:
  > what works, what is missing and what is fragile, drawn into the map as open
  > questions and notes, with up to five n8n integrations suggested for the gaps and a
  > short written summary. Trigger phrases: "review my architecture", "evaluate this
  > build", "what's missing from this map", "is this setup sound". Builds the map with
  > git-map or business-map first if none exists. NOT for a harsh critique or
  > stress-test (that is grill-build, used only when the user asks to grill, tear
  > apart or brutally review), NOT for grilling a plan with no build or map, NOT for
  > building n8n workflows, and NOT for exporting a map as an image (doc-map).

### `grill-build`: adversarial, on explicit ask only

- **Trigger**: only the explicit asks in decision 9. The draft description in
  `docs/design/skills-and-plugin.md:131-135` stands as the starting point.
- **Stance** (decided: no cost axis, see the decisions block): challenge every tool
  choice on lock-in, single points of failure, scaling and operational burden (`docs/design/skills-and-plugin.md:46`). Harsh
  means specific and unsparing, not louder. Every challenge is anchored to a node, like
  every rationale. "Everyone knows X doesn't scale" fails the same grounding rule as
  "most teams use X".
- **Stronger alternatives** are `suggested` nodes with trade-offs. The IR has no way to
  say "replaces". **Proposed**: the alternative `cites` the node it would replace and is
  wired beside it, and one gold note attached to both states the trade-off. There is no
  `replaces` field, to avoid a third schema change. Accepting a replacement is two user
  actions: accept the new node, then remove the old one. The skill asks both in one
  message. Listed in §6.
- **The same cap of five.** A grill that proposes fifteen swaps is the popularity
  failure again.
- **~~The cost axis has the same data problem as question B.~~ Withdrawn: there is no
  cost axis.** "This costs too much" needs
  a budget, and "cheaper alternative" needs a price. Until B is answered, `grill-build`
  may challenge cost only in terms the map supports (usage-based pricing on a flow the
  user said is high-volume, three overlapping tools doing one job). It never quotes a
  price from memory.
- **The last axis is n8n itself.** Every suggestion is an n8n integration (decision 2),
  so a grill that never questions "does this business need an automation platform at
  all" is not harsh. **Proposed**: `grill-build` may say so in a note. It still suggests
  only from the catalogue.

### Boundaries added

| Request | Goes to | Not |
|---|---|---|
| "Review my architecture" (map exists) | `eval-build` | `grill-build` |
| "Grill my architecture", "tear this build apart", "stress-test this stack" | `grill-build` | `eval-build` |
| "Grill me on this plan" (no build, no map) | not SequentDraw | `grill-build` (`docs/design/skills-and-plugin.md:94`) |
| "What CRM should a small cleaning company use?" (no map) | not SequentDraw | `business-map`, `eval-build` |
| "Suggest integrations for this map" (map exists, no review asked) | `eval-build` (decided, default 8) | `business-map`, `grill-build` |

### Changes to shipped skills and the hook

- `skills/business-map/SKILL.md:3` and `154-156`: remove "NOT for recommending tools
  (not shipped yet)" and the refusal. Add the suggestion step between steps 4 and 5.
- `hooks/session-start.js:15`: move `eval-build` and `grill-build` from "not shipped" to
  the skill list, and keep the note under 1,500 characters
  (`docs/design/skills-and-plugin.md:107-110`). It is 1,043 characters today (**measured**).
  for this document.
- The existing `business-map` evals re-run, because the description changes.

## 5. Proving it works

### Engine tests (offline, deterministic)

- Measurements A1–K from §1 become fixtures. Under the proposed "completeness ignores
  suggestions" rule, A2 and D2 must **report** the gap and B, C and H must **not**.
- One fixture per new structural code and per product code, each passing and failing.
- The Medusa measurement (`docs/design/business-map.md:221-225`) still yields exactly
  four gaps after five valid suggested nodes are added to it.
- `--emit-open` on a map with suggestions: the copy keeps them byte-for-byte, adds no
  `q_` node whose subject is a suggestion, and passes `check`, except for the rule-6a
  case (`docs/design/business-map.md:292-313`).
- Accept and decline as document transforms: an accepted node validates with no
  `rationale` or `cites`, and a declined node leaves no orphan behind.
- The catalogue loader, whatever question A decides: bounded, and it never throws on a
  malformed file. If the source is remote, no test touches the network.

### Skill evals (named here, written in the step 7 PR)

The shapes are the ones already under `evals/`. Deterministic graders come first, with
an LLM rubric only for judgement calls (`docs/design/skills-and-plugin.md:167-185`).
**Every regex below is written against CLI output that does not exist yet.** The
patterns are fixed in the implementing PR from real output, not from this document.
That is the lesson of #40 and #42.

**`business-map` suggestion step**

| Case | Prompt (gist) | Graders |
|---|---|---|
| `business-map-output-suggestions` | The scripted cleaning-business interview from `evals/business-map-output-open-nodes/prompt.md`, plus "then suggest integrations". Needs the catalogue available in the sandbox. | `fires-business-map`; `check` on the suggested copy passes (regex on the real line); `catalogue` was read before suggestions were written (`tool_used` or regex); rendered HTML exists |
| `business-map-output-no-suggestions-when-declined` | Same interview, "no tool recommendations, just the map" | `fires-business-map`; no `"status": "suggested"` in the written document (regex on trace) |
| `business-map-no-trigger-tool-question-no-map` | "What's the best invoicing tool for a small cleaning company?" | `no-business-map` |

**`eval-build` / `grill-build` confusion (both directions, required by
`docs/design/skills-and-plugin.md:182-183`)**

| Case | Prompt (gist) | Graders |
|---|---|---|
| `eval-build-trigger-review-architecture` | "Review the architecture in examples/medusa-return-flow.json." Scaffolded like `evals/doc-map-trigger-docs-image`. | `fires-eval-build` |
| `eval-build-trigger-whats-missing` | "What's missing from our booking map?" (scaffolded map) | `fires-eval-build` |
| `grill-build-trigger-tear-apart` | "Tear apart the build in examples/medusa-return-flow.json." | `fires-grill-build` |
| `grill-build-trigger-stress-test` | "Stress-test this stack. Be brutal." (scaffolded map) | `fires-grill-build` |
| **`eval-build-no-trigger-grill-request`** | "Grill my architecture in examples/medusa-return-flow.json. Don't go easy." | `no-eval-build` (`min: 0`, `max: 0`). Confusion, grill → not eval. |
| **`grill-build-no-trigger-review-request`** | "Review my architecture in examples/medusa-return-flow.json." | `no-grill-build`. Confusion, review → not grill. |
| `grill-build-no-trigger-plan-no-map` | "Grill me on my plan to launch a tutoring agency." | `no-grill-build`, `no-eval-build` |
| `eval-build-no-trigger-n8n-workflow` | "Build me an n8n workflow that emails new leads." | `no-eval-build`, `no-grill-build` |

**Output cases**

| Case | Prompt (gist) | Graders |
|---|---|---|
| `eval-build-output-medusa` | Review the scaffolded Medusa map, no questions asked | `fires-eval-build`; `check` passes on the result; rendered HTML exists; `llm` rubric: every suggestion's rationale names a node in the map |
| `grill-build-output-medusa` | Grill the same map | `fires-grill-build`; `check` passes; rendered HTML exists; `llm` rubric: each challenge is anchored to a node and names a trade-off, and the critique is direct rather than balanced (`docs/design/skills-and-plugin.md:173`) |

That is 13 new cases, on top of 17 on `main` (`evals/`, **measured** by listing). How
long a full run takes was not measured. The per-skill `--case` narrowing in
`docs/design/skills-and-plugin.md:208-214` applies. A budget/region output case is
deliberately **not** named. What it would grade depends on question B.

## 6. Open questions for the owner

1. **A. Where does the n8n integration catalogue come from? (licensing) — decided 2026-09-17: SequentDraw writes its own list (top of document).**

   The pool every suggestion must come from is n8n's integration catalogue
   (decision 2). n8n is published under the Sustainable Use License. Read from
   `github.com/n8n-io/n8n/blob/master/LICENSE.md` on 2026-09-17, its terms are:
   *"You may use or modify the software only for your own internal business purposes or
   for non-commercial or personal use. You may distribute the software or provide it to
   others only if you do so free of charge for non-commercial purposes"*; anyone who
   receives a copy of any part must also receive the terms; `.ee.` files are under a
   separate enterprise licence; and *"Any use of the licensor's trademarks is subject to
   applicable law."* SequentDraw is MIT and meant to be distributed. Its standing rule is
   that nothing from n8n's source, styles or assets enters the repository (`CLAUDE.md`,
   rule 4; `docs/design/n8n-visual-style.md:11-15`).

   The distinction that matters: **an integration's name is arguably a fact**. n8n can
   send email through Gmail, and "Gmail" is Google's name, not n8n's. **n8n's node
   definitions are its code and assets**: descriptions, parameter `properties`,
   credential schemas and icons. Whether n8n's internal node-type identifiers (for
   example `n8n-nodes-base.stripe`), or the *selection* of which integrations exist
   taken as a whole, are facts or part of the software is exactly what this document
   cannot settle.

   | Option | What ships in SequentDraw | Licence and legal risk | Other costs |
   |---|---|---|---|
   | **1. Hand-curated list SequentDraw writes itself** | A file of integration display names, SequentDraw's own categories and SequentDraw's own one-line descriptions. No n8n descriptions, parameters, credential schemas or icons. Icons, if any, from Simple Icons (CC0). Precedent: the hand-written tech → icon table in `src/scan/crosswalk.js`. | Lowest of the options, provided it is compiled by hand from public documentation and not generated from n8n's `packages/nodes-base` or by scraping their integrations pages wholesale. Residual risks: (a) whether a list of what n8n supports, as a whole, is a compilation derived from their work; (b) whether storing n8n's node-type identifiers crosses from fact into code; (c) trademarks, both n8n's and each third party's, used nominatively. Not reviewed by anyone qualified. | Maintained by hand. Goes stale as n8n adds and removes nodes, so a suggestion may name something n8n no longer offers. Small and deliberate, which suits a 3–5 pick. |
   | **2. Fetch at runtime from a public n8n endpoint** | Nothing, or a URL. | `https://api.n8n.io/api/nodes` exists and returned JSON on 2026-09-17 (**measured**). The entries seen (a summarised fetch, so not every entry and not a guaranteed-complete field list) have `name`, `displayName`, `description`, `properties`, `icon`, `iconData` (base64), `sourceCodePath`, `codex`, `group` and `popularity`. That payload *is* n8n's node definitions and icons. SequentDraw would have to discard everything except the name on receipt and never cache the rest, because caching to disk would be copying. No terms statement appeared in the response. n8n's website and API terms of use were **not read**. The endpoint's status (documented, stable, meant for third parties) is **unverified**. | Breaks the engine's offline, deterministic core. Evals and CI cannot reach the network. Adds an outbound dependency to the future HTTP surface. The `popularity` field hands the host the exact bias decision 7 forbids. |
   | **3. Read from the user's own n8n instance** | Nothing. | The user runs n8n under their own SUL rights, for their own internal business, and SequentDraw ships no n8n data. Whether n8n's public REST API exposes the installed node types at all is **unverified**. | Only works for users who already run n8n. Most SME users of `business-map` will not. |
   | **4. Use a third-party catalogue** | A dependency. | Example: `czlonkowski/n8n-mcp` reports `MIT` through the GitHub licence API (**checked** 2026-09-17). Whether it redistributes n8n node definitions, and so inherits n8n's terms whatever its own licence says, is **not checked**. A permissive licence on the wrapper does not settle the data inside it. | A supply-chain dependency (compare `docs/design/git-map.md`, "Supply chain"), plus the same staleness as option 1. |
   | **5. Ask n8n GmbH, or get a legal read** | Depends on the answer. | Removes the guesswork. | Time, and possibly cost. |
   | **6. Reopen decision 2** | A SequentDraw capability taxonomy ("send email", "take card payments") with tools named by the host. | No n8n data at all. | Loses "every suggestion is buildable as an n8n workflow", and "drawn from the catalogue" becomes "drawn from a category". This reopens a settled decision, so it is listed only for completeness. |

   **Not decided here.** Options 1 and 5 can be combined. Until this is answered, §3's
   `suggestion-not-in-catalogue` rule has no catalogue to check against, and step 7
   cannot be built.

2. **B. Budget and region: where does the information come from? — decided 2026-09-17: rule withdrawn, suggestions are workflow improvements only.** Today, nowhere (§2,
   "Budget and region"). The options:
   (a) one question inside the suggestion step, with the answer kept in a map-level
   note, which needs no schema change but which the engine cannot read;
   (b) the same question with the answer in a new top-level field, a schema change;
   (c) a catalogue that carries price bands and regional availability, researched and
   maintained by SequentDraw, which depends on question A and goes stale;
   (d) narrow the rule for step 7 to its graph-constrained form
   (`docs/HANDOVER.md:179-182`: constrained by what is in the graph, not by what is
   common) and treat budget and region as a later step.
   **(a) and (d) together are the smallest change that stays honest**, but choosing is
   the owner's call. Whatever is chosen, the skills must not claim a fit they have no data
   for, and `grill-build` must not quote prices from memory.
3. **Completeness and suggestions — decided 2026-09-17: ignore suggestions entirely.** Ignore suggestions entirely (proposed, §1), or
   treat them like `open` nodes, which satisfy rules but are never subjects (simpler,
   but a proposal then counts towards completeness, as measured in A2 and D2)?
4. **`cites` and `integration` as schema changes — decided 2026-09-17: both added.**
   `cites` (1–10 unique node ids) is required on a `suggested` node and forbidden on any
   other status; every entry must be a declared node that is not itself suggested.
   `integration` must be an id in `src/catalogue`; it is required on a `suggested` node
   and **stays on the node when the suggestion is accepted**: the node flips to
   `confirmed`, `rationale` and `cites` are dropped, and `integration` still says which
   tool it is. At most five `suggested` nodes per document. These replace the §3 table
   (which proposed 1–5 cites and split the catalogue rules into `check`): all are in
   `validateDoc`, with the codes `cites-required`, `cites-not-allowed`, `invalid-cites`,
   `duplicate-cite`, `unknown-cite`, `cite-is-suggested`, `integration-required`,
   `invalid-integration`, `unknown-integration` and `too-many-suggestions`. The JSON
   Schema enforces the shapes, required/forbidden by status and the five-suggestion cap;
   whether a cite exists, whether it is suggested, and whether an integration is in the
   catalogue are `validateDoc`-only. The original question follows. Accept both (proposed, §3). The
   no-schema-change alternative is to put cited node ids and the catalogue key into the
   rationale text in a fixed syntax the engine parses, which prints them on the details
   card, or to match the node `label` against catalogue names, which breaks as soon as
   the user edits a label. Also: does `integration` stay on an accepted node?
5. **Is zero suggestions an acceptable outcome?** HANDOVER says "three to five per map"
   (`docs/HANDOVER.md:176-178`). Proposed: five is a cap, three is a target, and fewer
   or none is correct when nothing in the catalogue fits an anchor.
6. **Remembering declined suggestions** across conversations. Proposed: not in step 7.
   The alternatives are a note, which uses the 20-note cap, or a new field.
7. **Replacements in `grill-build`.** Proposed: a suggested node that `cites` the node
   it would replace, plus a trade-off note. The alternative is a `replaces` field
   (a schema change) with a dedicated visual.
8. **"Suggest integrations for this map" with no review asked.** Proposed: run
   `business-map`'s suggestion step against the existing map, which means the
   `business-map` description has to cover it. The alternative: route it to
   `eval-build`.
9. **`eval-build` on base-only maps gets no engine gap findings** (measurement G). Does
   this raise the priority of `business-map.md` open question 2 (rules 1, 2 and 4 on
   base-only maps), or is `eval-build` on a technical map acceptable as host judgement
   plus suggestions?
10. **`source` on an accepted suggestion.** Proposed `"user"`, since the user asserted
    it. The alternative: keep `"model"` as provenance. Nothing in the enum
    (`src/n8n/validate.js:33`) means "suggested by the model, accepted by the user".
11. **Should `grill-build` be allowed to question n8n itself** (§4)? Proposed: yes, in a
    note. It still suggests only from the catalogue.

## 7. Credits

Nothing new is used. `czlonkowski/n8n-mcp` is named in §6 as an option only. If it is
adopted, it goes into `CREDITS.md` with its licence and its data provenance checked
(`CLAUDE.md`, rule 4). The Sustainable Use License text is quoted in §6 for the owner's
decision. No n8n code, data or asset informed this document beyond the field names
observed in the endpoint response.
