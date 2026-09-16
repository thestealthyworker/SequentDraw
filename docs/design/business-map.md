# Design: `business-map` (build step 6)

Status: **proposed** · 2026-09-16

`business-map` turns a conversation with the user into a SequentDraw map of how their
business takes one unit of work from "work is needed" to "paid". It writes the
`business` and `edge` layers, which no scanner can produce (`docs/HANDOVER.md:126-133`),
and it ships with the first implementation of the completeness checks that
`docs/SPEC.md:261-277` specifies and nothing in `src/` yet enforces. Its suggestion
step is build step 7 and is out of scope here (`docs/design/skills-and-plugin.md:239`).

Decisions already made by the lead developer, written up here and not reopened:

1. `sequentdraw check` makes `--evidence` **optional**. A business map has no scan
   bundle. With `--evidence`, evidence cross-referencing runs as it does today; without
   it, only the structural and completeness checks run.
2. Completeness checks **report by default** and never mutate. `check` prints one
   `path  message` line per gap and exits non-zero, the same shape as its existing
   errors.
3. Emitting open nodes is **explicit**: `--emit-open <out.json>` writes a **copy** with
   an open node (carrying a `prompt`) per unresolved gap. The input file is never
   modified in place.
4. `business-map` runs **inline, never `context: fork`**: it is a conversation
   (`docs/design/skills-and-plugin.md:101-103`).
5. The interview is about eight questions tracing **one** unit of value from "work is
   needed" to "paid". It writes the `business` and `edge` layers.
6. Suggestions are step 7. `business-map` ships at step 6 without them.

## Principle: the map is the questionnaire

The user is an author of the map, not a reviewer of it (`docs/SPEC.md:226-229`). The
skill never fills a gap with a plausible answer. Anything the user does not know, or
skips, becomes an `open` node with a `prompt`, drawn in the map, and a partly answered
map is still a usable artifact (`docs/SPEC.md:241-244`). The engine, not the skill,
decides what counts as a gap: the same rules, in the same code, for a business map and
for a map someone wrote by hand. What a rule applies *to* is scoped by layer, because a
question that is real on a business map is noise on a technical one (see "Which run
when").

The renderer already knows how to draw the answer to a question it has not been asked
yet: an `open` node gets a 2px dashed muted border, a grey fill and a "?" badge
(`src/n8n/render-svg.js:41-48`, `64-69`; `docs/design/n8n-visual-style.md:50`), its
`prompt` becomes the hover title (`src/n8n/render-svg.js:92`) and the "Open question"
line of its details card (`src/n8n/card-data.js:93`;
`docs/design/n8n-visual-style.md:139`). `status` and `prompt` are in the schema and the
validator (`schema/sequentdraw.schema.json:147-165`; `src/n8n/validate.js:32`, `43`,
`567`, `570`). What is missing is the thing that decides when to write one.

## Pipeline

```
user  ◄──── eight questions, one unit of value ────►  business-map skill (inline)
  │                                                      │
  │  answers, "I don't know", "skip"                     ▼
  │                                        workflow JSON: business + edge layers,
  │                                        source: "user", open nodes for unknowns
  │                                                      │
  │            sequentdraw check map.json --emit-open gaps.json     engine, deterministic
  │                                                      │  structural + completeness;
  │                                                      │  a copy with one open node per gap
  │                                                      ▼
  │            sequentdraw check gaps.json  ──► ok        the copy is complete by construction
  │                                                      │
  │            sequentdraw render gaps.json map.html --fragment
  │                                                      ▼
  └──── answers to open nodes, in conversation ◄── publish private artifact + local copy
```

## 1. The interview

Eight questions, asked in order, one unit of value. Each row says what the question
writes into the IR and what happens when the user does not know. "Does not know" and
"skip" are the same answer: an open node with a prompt. The one exception is the first
question, which has no fallback because everything else hangs off it.

Every node and edge the interview writes carries `source: "user"`
(`schema/sequentdraw.schema.json:154-158`, `256-261`) and `status: "confirmed"`
(the default) unless the row says `open`.

| # | Asks | Writes | If the user does not know |
|---|---|---|---|
| 1 | **The unit of value.** "What is the one thing a customer pays you for: a booking, a job, an order, a case?" | The map `title` ("How a booking becomes a paid job"), and a map-level sticky note naming the unit of value and the date of the interview. | No open node. The skill offers the user's own words back as candidates and continues only once one is accepted. A map with no unit of value has nothing to trace, so the skill says so and stops rather than picking one. |
| 2 | **The trigger.** "How does work arrive? Who asks, and through what: a call, a form, WhatsApp, a referral?" | An `external` node for the requester (`layers: ["business"]`), a `manual` or `service` node for the channel (`["base", "business"]` or `["base"]`), and a solid edge requester → channel. | Open `external` node, label "Who starts this?", prompt "Work arrives at <channel> but you could not say who sends it or how it reaches you." |
| 3 | **The first decision.** "Who decides whether to take the work, and on what?" | A `human` or `logic` decider node in `base`, with dashed `condition` edges for each outcome the user names ("accepted", "declined"). If the user says every request is taken, no decision node is written and the note records that. | Open `logic` node, label "Who decides?", prompt "Requests are accepted or declined but you could not say who or what decides, or on what grounds." |
| 4 | **The work.** "Walk me from accepting the work to it being done. What are the steps, and who does each one?" | One `manual` or `service` node per step in `base` (`manual` steps also carry `business`), a `human` node in `business` for each named doer with an edge doer → step, solid edges between steps. Sublabels stay at three words (`src/n8n/validate.js:41`). | For a step with no named doer: open `human` node, label "Who does this?", prompt "<step> happens but you could not say who performs it." For two systems in a row, the skill asks how work moves between them and writes the answer as the edge `description`; that is what rule 3 below checks. |
| 5 | **The handover.** "What does the customer actually get, and how does it reach them?" | An `artifact` node in `business` for each deliverable (the report, the signed job card, the parcel), an edge from the last step to it and an edge from it to the recipient (`human` or `external`). | Open `external` node, label "Who receives this?", prompt "<artifact> is produced but no one is named as receiving it." This is rule 1. |
| 6 | **Money, or the discharged obligation.** "How do you get paid, and what tells you it is settled: an invoice, a card payment, a deposit, a signed acceptance?" | An `artifact` node for the invoice or receipt, the payment `service` (or a `manual` "bank transfer") node, and edges through to the party the money comes from and the person who sees it settle. | Open `artifact` node, label "How is this paid?", prompt "The work is delivered but you could not say how payment or sign-off happens, or who confirms it." Rule 5 catches the graph shape of this gap. |
| 7 | **The unhappy paths.** "What goes wrong most often: nobody replies, the work is rejected, the customer disputes it. Who handles each?" | One `edge`-layer node per failure named, reached by a dashed edge with a `condition` from the step it branches off, and a `human` owner (`["edge", "business"]`) for each. Three failures is the budget; the skill asks for the ones that actually happen, not every one imaginable. | For a failure with no owner: open `human` node in `edge`, label "Who handles this?", prompt "When <failure> happens, nobody is named as dealing with it." If the user can name no failure at all, the skill writes none and lets rule 6 report the empty layer. |
| 8 | **The systems.** "Which of these steps run in software today, and which are done by hand?" | Flips `manual` steps to `service` (and adds an `icon` slug only when the user names the product; never a guessed brand, `docs/SPEC.md:129-136`) or the other way round. Where two steps are both systems, the user's answer to "how does one reach the other" becomes the edge `description`; if a person carries the data between them, a `manual` node is inserted. | Nothing is flipped. A `manual` node the user is unsure about keeps `manual`: hand-done is the honest default for a business flow, and the only kind that never claims code exists. |

Rules the interview keeps:

- **Never re-ask what the user already told you.** A user who opens with the whole
  story has answered several questions; the skill confirms its reading in one message
  rather than walking the list.
- **One lifecycle.** Not every customer type, not every branch. The map that tries is
  the one nobody reads (`docs/SPEC.md:274-277`).
- **An existing map is extended, not replaced.** If a map from `git-map` is in the
  conversation or named by the user, the interview writes into that document. Its
  `open` nodes become the first questions asked (the codebase as negative space,
  `docs/HANDOVER.md:130-132`). The skill never scans a repository itself.
- **Answers to open nodes are conversational.** "The office manager receives it" turns
  `q_recipient_invoice` into a confirmed `human` node with `source: "user"`, re-runs
  `check`, and republishes to the same artifact
  (`skills/git-map/references/artifact-output.md:19-21`).

### Where things go

`base` is the always-visible happy path (`docs/SPEC.md:286`), so every step in the
lifecycle carries `base`. The layers this skill *adds* are `business` (actors,
artifacts, external parties, manual handoffs, `docs/SPEC.md:288`) and `edge` (failures
and their owners, `docs/SPEC.md:287`). Edges carry no `layers`; they show when both
endpoints do (`src/n8n/edge-visibility.js:18-20`).

| Kind | Layers |
|---|---|
| `manual` step on the happy path | `["base", "business"]` |
| `service` step, `logic` decider | `["base"]` |
| `human`, `external`, `artifact` | `["business"]` |
| any failure node and its owner | `["edge"]`, plus `"business"` for a `human` owner |

The reference fixture `examples/medusa-return-flow.json` keeps its `manual` steps in
`business` alone. That is a hand-written example, not a rule; with `business` toggled
off a map written that way loses its happy path, which is what `base` exists to keep.
Listed under open questions.

## 2. Completeness checks

### What "complete" means here

Absolute completeness is not the goal and chasing it produces a map nobody reads. The
working definition is SPEC's: **one full lifecycle of the unit of value, with a named
owner at every handoff. If a reader can answer "who does what next, and what do they
get", it is done** (`docs/SPEC.md:274-277`).

The engine's version of that sentence is six rules, each of which asks one question
about one node, fires at most once per subject, and never follows the graph more than
one edge. There is no transitive closure and no scoring. The check is bounded the same
way validation is: the array caps in `src/n8n/validate.js:74-78` apply before any
per-item work, and the report stops at the same 100 errors
(`src/n8n/validate.js:101`; `src/scan/check-evidence.js:21`).

Two properties make the rules a questionnaire rather than a linter:

- **An open node satisfies a rule.** A rule asks whether *anything* stands where an
  owner, recipient or outcome should be. An `open` node standing there means the gap
  has already been drawn, and that is the whole point.
- **An open node is never a subject.** Rules ask questions about confirmed content.
  Asking "who receives the thing we do not know who receives" is noise, and skipping
  open subjects is what makes `check` idempotent: after `--emit-open`, the copy passes.

### The six rules

`path` is the JSON Pointer of the subject, `code` is stable and kebab-case, and
`message` names the item and the fix, matching `src/n8n/validate.js:9-12` and
`src/scan/check-evidence.js:9-10`. Today's CLI prints `path  message` only
(`src/cli/check.js:93`, `102`); codes are returned by the function for tests, and for
the HTTP and MCP surfaces later.

In every emitted node: `status: "open"`, a `prompt` under 500 characters
(`src/n8n/validate.js:43`), `id` prefixed `q_` (see "Emitted nodes"), and `layers`
copied from the subject so the question is visible wherever the thing it asks about is.

| Rule (`docs/SPEC.md:264-269`) | Code | Subject and test | Emits | Wires |
|---|---|---|---|---|
| 1. Every `artifact` has a named recipient | `artifact-no-recipient` | An `artifact` node with **no outgoing edge**. (An artifact whose only consumers are systems does not fire; see open questions.) | `external`, label "Who receives this?", prompt "<label> is produced but nothing in the map receives it. Name the person or party it goes to." | solid edge artifact → q |
| 2. Every external input has a named source actor | `input-no-source-actor` | A node with **in-degree 0** whose kind is not `human` or `external`, and whose layers include `base` or `business`. `edge`-only and `build`-only nodes are skipped: a failure branch or a CI job is not an entry point. | `external`, label "Who starts this?", prompt "<label> is where work enters but nothing in the map sends it. Who asks, and through what?" | solid edge q → node |
| 3. Every handoff between two systems that is not an API call is an undrawn human step | `handoff-undrawn` | An edge `service → service` with `source: "user"` and **no `description`**. Interview question 8 always writes the mechanism into the description, so a user-sourced edge without one is an unanswered question. Scan and unsourced edges are skipped, because an API call and a re-keyed spreadsheet look identical in the graph (see "Measured on the fixture"). | `manual`, label "How does this move?", prompt "Work goes from <from> to <to>. If a person carries it, who? If a system call, say so and describe the edge." | **inserts**: from → q → to, both edges keeping the original `type`; the original edge is replaced in the copy |
| 4. Every decision has a named decider, `human` or `logic` | `decision-no-decider` | A node with **two or more outgoing edges carrying a `condition`** (a split, `docs/SPEC.md:66-71`) whose kind is not `human` or `logic`. | `logic`, label "Who decides?", prompt "<label> branches on <condition list> but is not a person or a rule. Who or what decides?" | **inserts**: subject → q (solid); the conditional edges move their `from` to q |
| 5. The flow reaches money or a discharged obligation, not merely "record saved" | `flow-dead-end` | A `business`-layer node with **out-degree 0** whose kind is not `human`, `external` or `artifact`. The lifecycle must end in someone's hands or in a document, never inside a system. Runs only when a `business` layer exists. The engine cannot recognise money; question 6 owns that, and this rule catches its graph shape. | `artifact`, label "What comes out of this?", prompt "The flow stops at <label>. What does it hand over, and to whom: an invoice, a receipt, a signed acceptance?" | solid edge sink → q |
| 6. Every unhappy path has an owner | `unhappy-path-no-owner` | An `edge`-layer node with **out-degree 0** whose kind is not `human`, `external` or `artifact`. Runs only when a `business` layer exists. | `human`, label "Who handles this?", prompt "When <label> happens, nobody in the map deals with it. Who owns it?" | solid edge node → q |
| 6a. No unhappy path at all | `unhappy-paths-missing` | A `business` layer exists and **no node carries `edge`**. Path `/`. | A **gold map-level sticky note** in `base` (the "Consider:" convention, `docs/HANDOVER.md:223`), content "Nothing goes wrong in this map. What happens when nobody responds, the work is rejected, or the customer disputes it?" There is no node to hang a question on, and inventing an anchor would be a guess. | none |

Which run when:

| Tier | Rules | Needs |
|---|---|---|
| Business, when any node carries `business` | 1, 2, 3, 4, 5, 6, 6a | A lifecycle to have an end, an owner and failures. On a base-only technical map "the flow stops at Postgres" is not a gap; it is where a technical map ends. |
| Not yet run on base-only maps | — | See the decision below. |

**All six rules gate on a `business` layer being present. Decided by the lead developer,
2026-09-16.**

An earlier draft ran rules 1, 2 and 4 on every map, on the argument that a webhook route
with in-degree 0 is exactly SPEC's "a webhook implies an upstream sender"
(`docs/SPEC.md:236-239`). That argument is sound, and this is not a rejection of it. It
is a sequencing decision:

- A `git-map` map carries `base` only. Rule 2 fires on any node with in-degree 0 whose
  kind is not `human` or `external` — which is the entry service of practically every
  scanned repository. `check` would then exit non-zero on a correct scan map.
- `evals/git-map-output-compose-app` grades that `check … --evidence` prints `ok`
  (`graders/check-evidence-passed.md`), and `skills/git-map/SKILL.md:115-122` tells the
  model to re-run `check` until it prints `ok`. Both would have to change, and
  `git-map` would need `--emit-open` wired into its pipeline.
- That case is currently green and is part of the M1 gate. Changing a passing gate to
  add a check that step 6 does not need is the wrong order of work.

So: step 6 ships all six rules gated on the business layer, and `git-map` output is
untouched. **Applying rules 1, 2 and 4 to base-only maps is a separate decision, after
M1 closes, in its own PR** — one that changes the skill, the grader and the pipeline
together, and is measured against a real scan before it merges. Logged as an open
question below.

### Measured on the fixture

The rules were tuned against `examples/medusa-return-flow.json` (40 nodes, 44 edges,
all four layers, `docs/HANDOVER.md:277-280`) before being written down, because a
rule that fires on the reference map's correct content is a rule that will be
switched off. The naive readings of SPEC over-fire:

| Naive reading | Fires on Medusa | Why that is wrong |
|---|---|---|
| Rule 1: recipient must be `human` or `external` | 6 artifacts | `return_model`, `order_txn`, `migrations` are data models consumed by services. The one true hit, `refund_out`, has no outgoing edge at all. |
| Rule 3: any `service → service` edge without a description | 7 edges | `storefront → store_api` and six more are ordinary API calls. Undescribed and undrawn are not the same thing. |
| Rule 5: every sink must be a party or artifact | 3 nodes | `postgres` is a sink on the technical layer. The business lifecycle ends at `refund_out`, which is right. |

The rules as written above fire four times on Medusa, every one a real question:
`refund_out` (rule 1: money has left the store but no edge reaches the customer) and
the three `edge`-layer dead ends `req_action`, `partial` and `cancel` (rule 6: who
handles a partial return, or a cancellation?). Rules 2, 3, 4 and 5 fire zero times.
The implementing PR keeps this as a test: those four, and only those four.

### Emitted nodes

- **Id**: `q_<rule>_<subject id>`, for example `q_recipient_refund_out`,
  `q_source_req_store`, `q_handoff_pay_mod_pay_provider`, `q_decider_gate`,
  `q_outcome_result`, `q_owner_cancel`. Ids must match `^[A-Za-z0-9_.:-]{1,64}$`
  (`src/n8n/validate.js:27`); longer ones are cut at 64, and a collision with an
  existing id gets a numeric suffix. The `q_` prefix is what the skill matches when the
  user answers.
- **`source`**: omitted. The enum is `scan | user | model`
  (`src/n8n/validate.js:33`) and an engine-emitted question is none of those. Listed
  under open questions.
- **Edges**: every emitted node gets an edge, because a node with no edges is an
  `orphan-node` error unless it is alone in its group
  (`src/n8n/validate.js:652-684`), and the copy must validate. Emitted edges carry
  no `source` and no `description`; they are `solid` unless they inherit a type from an
  edge they replace (rule 3) or move (rule 4).
- **Group**: the subject's `parentId`, so the question sits beside the thing it asks
  about.
- **Kind glyph, no icon**: the kind glyph is the right mark for a thing that does not
  exist yet (`docs/SPEC.md:45-46`).
- **Rules 3 and 4 insert; the others append.** Insertion is a copy-only operation
  that replaces or re-points an existing edge; the source document is untouched. Once
  edges can carry `status` and `prompt` (open question 1), rule 3 marks the edge open
  and stops inserting.

## 3. CLI contract: `check`

```
sequentdraw check <map.json> [--evidence <bundle.json>] [--emit-open <out.json>]
```

Today `--evidence` is required (`src/cli/check.js:14`, `54-56`); `check` without it
prints usage and exits 1. The order of work stays as it is now: read, validate,
then the cross-reference passes (`src/cli/check.js:83-107`).

| Invocation | Runs | On success | On problems |
|---|---|---|---|
| `check map.json` | structural (`validateDoc`), then completeness | prints `ok`, exits 0 | one `path  message` line per problem on stderr, exits 1 |
| `check map.json --evidence b.json` | structural, then evidence (`src/scan/check-evidence.js`), then completeness | `ok`, 0 | as above; evidence errors and gaps are listed together, since both are reported in the same shape |
| `check map.json --emit-open gaps.json` | structural, then completeness | writes the copy, prints `wrote gaps.json (<n> open node(s))` on stdout and each gap's `path  message` line on stderr, exits **0** | structural errors: listed, exit 1, **nothing written** |
| `check map.json --evidence b.json --emit-open gaps.json` | structural, evidence, completeness | as the row above | structural or evidence errors: listed, exit 1, nothing written. Gaps alone are not errors here: they are what the flag asked for |
| `check map.json --help` | | prints help, exits 0 | |
| unknown flag, extra positional, `--emit-open` with no value | | | usage, exit 1, nothing written (`src/cli/index.js:7-9`) |

Rules the contract keeps:

- **The exit code answers "did the command do what it was asked".** Asked to report,
  a gap is a failed report and the exit is 1. Asked to emit, a gap emitted is the job
  done and the exit is 0. The gap lines are printed either way, in the same shape, so a
  skill can read them off stderr in both modes.
- **Nothing is written on any error.** Unreadable input, a structural error, an
  evidence error, an output path that cannot be written, or a copy that would breach a
  cap (100 nodes, 500 edges, 20 notes, `src/n8n/validate.js:74-78`): the message is
  printed, the exit is 1, and no file exists that did not exist before. Same guarantee
  as `render` (`src/cli/render.js:3-5`).
- **The input is never modified in place.** `--emit-open` naming the input path,
  after both are resolved, is a usage error. Any other existing file is overwritten,
  as `render` overwrites (`src/cli/render.js:116-119`); the skill, not the CLI, asks
  before overwriting anything in a repository.
- **The copy is the user's document plus the questions.** It is built from the parsed
  input, not from `validateDoc`'s normalised form, so the user's own fields and
  ordering survive; emitted nodes, edges and the rule-6a note are appended (rules 3 and
  4 replace or re-point one edge each). Written with two-space indentation and a
  trailing newline.
- **Zero gaps still writes the copy.** The skill has one path to render either way.
- **The copy passes.** `check gaps.json` on the written file prints `ok`. This is
  tested, and it holds because open nodes satisfy the rules and are never subjects.
- **`--emit-open` does not run the suggestion agent, resolve icons, or lay anything
  out.** It writes questions and nothing else.

Proposed location for the engine half: `src/gaps/completeness.js`, a pure function
`checkCompleteness(doc) → { errors, additions }` in the same defensive style as
`src/scan/check-evidence.js` (never throws on a malformed document, bounded before
per-item work), with `src/cli/check.js` doing the wiring. The implementing PR decides
the final path; this document fixes the contract, not the file name.

**Consequence for `git-map`, to confirm.** Because rules 1, 2 and 4 run whenever
`check` runs, a scan map whose entry service has in-degree 0 will now fail
`check --evidence` with `input-no-source-actor`. That is SPEC's intent
(`docs/SPEC.md:236-239`; `docs/design/git-map.md:166-171` already says `git-map`
writes an open node per gap), but `git-map`'s SKILL.md step 4 says `check` prints `ok`
(`skills/git-map/SKILL.md:115-122`) and its output eval grades on exactly that
(`evals/git-map-output-compose-app/graders/check-evidence-passed.md:4`). The step 6 PR
either adds `--emit-open` to `git-map`'s pipeline or writes the source actor in step 3;
either is a one-line skill change plus an eval run. Open question 2.

## 4. The skill

`skills/business-map/` mirrors `skills/git-map/` (`SKILL.md`, `references/`,
`scripts/sequentdraw.sh`, `docs/design/skills-and-plugin.md:114-127`), with two
differences: no `context: fork` in the frontmatter, and a `references/interview.md`
holding the eight questions in full so `SKILL.md` stays short.

Description, to be tuned by the trigger evals (`description` plus `when_to_use` under
1,536 characters, and it must say what the skill is not for:
`tests/skill-description-length.test.js:15`, `docs/design/skills-and-plugin.md:89`):

> Map a business idea or process as an interactive SequentDraw map by interviewing the
> user: about eight questions tracing one unit of value from "work is needed" to
> "paid", written as business and edge layers with an open question drawn in the map
> for anything the user cannot answer. Trigger phrases: "map how our business takes and
> fulfils a booking", "map my business", "draw our process from enquiry to invoice",
> "map this idea". Runs as a conversation, never as a background agent. NOT for
> mapping a code repository (that is git-map), NOT for exporting an existing map as a
> static image (that is doc-map), NOT for recommending tools (not shipped yet), NOT for
> building an n8n workflow, and NOT a general chart or Mermaid tool.

Steps, in the same order as `git-map`'s:

1. **Find or start the document.** Extend a map already in the conversation or named
   by the user; otherwise start an empty document with the title from question 1.
2. **Interview** (section 1). Confirm what the user has already said, ask the rest,
   write `open` nodes for every "don't know" and "skip".
3. **Validate**: `<sequentdraw> validate map.json`, and fix only what the interview
   wrote.
4. **Check and emit**: `<sequentdraw> check map.json --emit-open gaps.json`. Read the
   gap lines back to the user in plain words ("Nobody receives the invoice in this map;
   I have drawn that as a question"). Then `<sequentdraw> check gaps.json` must print
   `ok`.
5. **Write the local copy first**, then render:
   `<sequentdraw> render gaps.json map.html --fragment`, into a session or temp folder
   outside any repository. Each CLI call is its own command beginning with
   `<sequentdraw>`, never chained behind a prefix (the narrow `Bash(node:*)` grant,
   `skills/git-map/SKILL.md:129-134`).
6. **Publish** a private artifact and give the link; print both local paths; write
   into a repository only when asked, asking before overwriting
   (`skills/git-map/references/artifact-output.md`).
7. **Answers are corrections.** An answer to a `q_` node replaces it with a confirmed
   node from the user, re-runs steps 3 to 5, and republishes to the same artifact.

The `using-sequentdraw` routing note (`hooks/session-start.js:14`) currently lists
`business-map` as not shipped; the step 6 PR updates that line and keeps the note under
1,500 characters (`docs/design/skills-and-plugin.md:107-110`).

### What `business-map` refuses to do

- **Scan a repository.** That is `git-map`. Handed a path or a GitHub URL, it says so
  and offers to run `git-map` first and interview against its result.
- **Export a static figure.** That is `doc-map`.
- **Suggest tools or integrations.** Step 7. Asked "what should I use for invoicing",
  it answers that it maps what exists and marks the gap, and that recommendations are
  coming.
- **Build or deploy an n8n workflow**, draw a general chart, or review or grill a plan.
- **Fill a gap with a plausible answer.** "Probably the office manager" is written as
  an open node, not as a confirmed `human`. The skill may propose wording for the
  user's own answer; it may not decide that something exists.
- **Chase completeness.** Eight questions, one lifecycle, at most three unhappy paths
  unless the user offers more. When rule 6a's note says nothing goes wrong, the skill
  asks once more and then leaves the note in.
- **Run as a fork**, write into a repository unasked, or scan the codebase for
  business facts (there are none there, `docs/SPEC.md:231-234`).

## 5. Proving it works

**Engine tests** (offline, deterministic), in the style of
`tests/scan-check-evidence.test.js` and the `check` block of
`tests/sequentdraw-cli.test.js:249-349`:

- one fixture per rule that fires, one that does not, and one where an open node stands
  in the gap and the rule stays quiet
- the Medusa measurement above: exactly four gaps, with those four codes and paths
- `--emit-open` output validates, re-checks to `ok`, preserves the input's own fields
  and order, and leaves the input byte-identical
- rules 3 and 4 insertion: the replaced edge's `type` and `condition` survive on the
  right side of the inserted node
- nothing written on: structural error, evidence error, unwritable path, cap breach,
  output path equal to input path
- the flag matrix in section 3, including `--evidence` and `--emit-open` together
- `orphan-node` never appears on an emitted copy

**Skill evals** (`claude plugin eval`), named here and written in the step 6 PR, in the
shapes already under `evals/` (`prompt.md` frontmatter `max_turns`, `allowed_tools`,
`runs`; `graders/*.md` with `type: tool_used` or `type: regex`; `case.yaml` with
`context.scaffold_script` whenever the prompt names a file, `scripts/preflight.js:99`,
`147-157`, `176`). Every case runs through `npm run preflight` before it is pushed.

| Case | Prompt (gist) | Graders |
|---|---|---|
| `business-map-trigger-cleaning-booking` | "Map how our cleaning business takes and fulfils a booking" (`docs/design/skills-and-plugin.md:171`) | `fires-business-map.md`: `tool_used`, `input_match: business-map`, `min: 1`, `arm: with-only` |
| `business-map-trigger-idea-no-code` | "I'm starting a tuition agency. Help me map how a student gets matched with a tutor and how I get paid." | `fires-business-map.md` |
| `business-map-trigger-enquiry-to-invoice` | "Draw our process from first enquiry to paid invoice." | `fires-business-map.md` |
| `business-map-no-trigger-repo-url` | "Diagram https://github.com/dockersamples/example-voting-app" (the confusion case with `git-map`, `docs/design/skills-and-plugin.md:97`) | `no-business-map.md`: `tool_used`, `min: 0`, `max: 0` |
| `business-map-no-trigger-n8n-workflow` | "Build me an n8n workflow that emails new leads." | `no-business-map.md` |
| `business-map-no-trigger-export-image` | "We already have a map at examples/medusa-return-flow.json. Export it as an image for our docs." Needs `case.yaml` + `fixture.sh` copying the example in, as `evals/doc-map-trigger-docs-image` does | `no-business-map.md` |
| `business-map-output-open-nodes` | A scripted interview: the prompt supplies the eight answers as the business owner would give them, with question 5's recipient and question 7's owner answered "I don't know", and says "don't ask me anything, proceed". `max_turns: 25`, `timeout_seconds: 600`, `runs: 2`, the same grant as `evals/git-map-output-compose-app/prompt.md:2-5` | `fires-business-map.md`; `emits-open-nodes.md`: `regex` on `trace`, `check[\s\S]{0,400}?--emit-open[\s\S]{0,400}?wrote [^\s"'\\]+\.json`; `recheck-passes.md`: `regex` on `trace`, the second `check` followed within a short window by `\bok\b`; `produces-map-or-artifact.md`: `regex` on `trace`, `wrote [^\s"'\\]+\.html`, weight 2 |

Skill evals are single-turn, so an interview cannot be evaluated as a dialogue: the
output case scripts the user's side into the prompt. The eval proves the skill writes
what it was told and draws what it was not told; whether it *asks* well is checked by
hand before each release, as Codex triggering already is
(`docs/design/skills-and-plugin.md:222-224`).

## 6. Open questions for the owner

1. **Edge-level `status` and `prompt` — decided: deferred.** SPEC says an unresolved
   question is "a node or edge" with `status: "open"` (`docs/SPEC.md:241-242`,
   `257-258`), but the schema gives edges no `status` and no `prompt`
   (`schema/sequentdraw.schema.json:209-262`; `src/n8n/validate.js:123`), and the
   renderer has no open-edge style (`src/n8n/render-svg.js:41-48` is node-only).
   Rule 3 is the rule that wants it: "how does work move along this edge" is a
   question about the edge, and today the check answers by inserting a node.

   **Owner's decision (2026-09-17): node-only for step 6.** Rule 3 inserts a node, as
   section 2 describes. Edge-level `status`/`prompt` is a schema change touching the
   validator, the schema parity test, the renderer and the card, and it does not block
   the interview or any of the six rules from working. It gets its own PR, on its own
   evidence, rather than riding along with step 6 — the same reasoning that kept the
   base-only-map question (2 below) out of the M1 gate.
2. **Completeness rules on base-only maps — deferred, not open.** Settled for step 6 by
   the lead developer (2026-09-16): all six rules gate on a `business` layer being
   present, so completeness runs in the same call as `--evidence` but finds no subjects
   on a `git-map` map. Nothing about `git-map` changes. See section 2, "Which run when".
   What remains genuinely open is the follow-up: rule 2's reading of SPEC's "a webhook
   implies an upstream sender" (`docs/SPEC.md:236-239`) is a real check that a scan map
   would benefit from, and it is switched off here only because turning it on means
   changing `skills/git-map/SKILL.md:115-122`, the
   `evals/git-map-output-compose-app` grader and `git-map`'s pipeline together, while
   that case is green and part of the M1 gate. Worth doing after M1 closes, in its own
   PR, measured against a real scan before it merges. Owner's call whether it is worth
   the churn at all.

   **Update, 2026-09-17: M1 has closed** (`docs/reviews/m1/round-2.md`, merged at
   `4bd3c85`), so the gate is no longer the reason to hold this. It is now an ordinary
   candidate, still requiring the skill, the grader and the pipeline to change together
   and to be measured against a real scan.
3. **`source` for engine-emitted nodes — decided: omit the field.** Adding `"engine"`
   to the enum (`schema/sequentdraw.schema.json:154-158`; `src/n8n/validate.js:33`)
   would touch the schema, the validator and the parity test for no user-visible gain:
   an emitted node is already identifiable by `status: "open"`, its `q_` id prefix and
   its `prompt`. Owner's decision, 2026-09-17.
4. **Exit code of `--emit-open` when gaps were emitted — decided: 0.** The job of that
   flag is to emit, and it did. A non-zero exit would also make `git-map`'s documented
   loop incoherent, since `skills/git-map/SKILL.md:115-122` tells the model to re-run
   `check` until it prints `ok` — a copy that is complete by construction must not
   report failure. Gaps are still visible: they are drawn in the map as open nodes, and
   a plain `check` on the *original* still exits non-zero. Owner's decision, 2026-09-17.
5. **Rule 1 and artifacts consumed by systems.** Medusa uses `artifact` for data
   models and migrations. Proposed: an artifact with any outgoing edge is received by
   something and does not fire. Alternative: those should not be `artifact` at all,
   and SPEC's "named recipient" means a party.
6. **Rule 5 cannot see money.** It checks that the business lifecycle ends in a party
   or an artifact. If the owner wants "reaches money" enforced literally, that needs a
   marker in the IR (a terminal flag, or a money kind), which is a schema change.
7. **Rule 6a's anchor.** A gold map-level note (proposed) versus an open node hung off
   a guessed anchor such as the entry node.
8. **Happy-path layers.** Steps carry `base` (proposed, `docs/SPEC.md:286`) versus
   the Medusa convention of `manual` steps in `business` only.
9. **Insertion by rules 3 and 4.** Allowed in the copy (proposed) or append-only, with
   the inserted question hung beside the edge instead?
10. **The third input mode** (a documented methodology as input,
    `docs/HANDOVER.md:135-139`) is still unnamed. Not in this step; confirm which
    methodology before anything is built.

## 7. Credits

Nothing new. No external code, dataset or repository informs this step; the
interview questions are drawn from `docs/HANDOVER.md` and `docs/SPEC.md`.
