# CTO review — M2 — initial

- **Gate:** M2 — the suggestion agent: `business-map` with its suggestion step, `eval-build` and `grill-build`, end to end on realistic business scenarios
- **Commit reviewed:** `4518f88` on `main` ("feat: business-map suggestions, eval-build and grill-build (build step 7) (#50)")
- **Date:** 2026-09-19
- **Reviewer:** `sequentdraw-cto` (Fable 5.1), `initial` mode
- **CI state at review:** `npm test` 988 passing / 1 skipped, all 30 skill-eval cases passing, `claude plugin validate . --strict` passing

The report below is the CTO agent's output, recorded verbatim.

---

Verdict: ACCEPT WITH FIXES

## Summary

The suggestion step and the two review skills do the job they exist for. The cleaning-business map is one its owner would recognise; the two things they said they did not know (who receives the job sheet, who chases a silent quote) are drawn as dashed "?" open nodes, not guessed; four suggestions (Pipedrive, Google Calendar, Xero, Jotform) are drawn in purple with a "+" badge, each rationale names the user's own words and the nodes it answers, and each says what it does not solve. Declining suggestions is respected. eval-build and grill-build on the Medusa fixture are specific to that map (requires_action dead end, refund call with no failure path, damaged items never reaching the refund amount), grill-build is harsh without being loud and answers "does this need automation at all", and every patch they produced validated through the engine first time. The one thing that must be fixed before this closes is reading order: on both cleaning maps the "Bank transfer" (paid) step is laid out at the far left, before the enquiry form, so the enquiry-to-paid story does not read left to right.

Environment note (not a product finding): my first four nested `claude -p` runs granted no tools, so every skill was blocked from running `node bin/sequentdraw`. All four degraded honestly: none claimed a map existed, each handed back the exact commands and patch. I re-ran scenario 1 once with the eval harness's tool grants (`--allowedTools Read Glob Grep Skill Bash`) and it completed end to end; a first retry attempt never started a session because I placed the variadic flag before the prompt. For scenarios 2–4 I fed the skills' own JSON and patches through `check --merge --emit-open` and `render` myself, so the maps and screenshots below are what those runs would have produced.

Artifacts (all under the session scratch directory `.../scratchpad/cto-m2/`):
- Scenario 1: `s1b-output.txt`, `s1/suggested.json`, `s1/map.html`, `s1-fit.png`, `s1-focus.png` (Pipedrive card), `s1-xero.png`, `s1-zoom-720.png`
- Scenario 2: `s2-output.txt`, `s2-map.json`, `s2/gaps.json`, `s2/map.html`, `s2-fit.png`, `s2-jobsheet.png`
- Scenario 3: `s3-output.txt`, `s3-patch.json`, `s3/review.json`, `s3/map.html`, `s3-fit.png`, `s3-focus.png` (Slack card)
- Scenario 4: `s4-output.txt`, `s4-patch.json`, `s4/grill.json`, `s4/map.html`, `s4-fit.png`, `s4-focus.png` (Postmark card), `s4-twilio.png`
- Blocked first runs: `s1-output.txt` … `s4-output.txt`

## Findings

| ID | Severity | Area | What I saw | Why it matters to users | Accept when |
|---|---|---|---|---|---|
| CTO-M2-01 | major | look | On both cleaning maps the last step, "Bank transfer" (customer pays, owner sees it land), is placed at the far left of the canvas, in the column before "Owner" and left of "Website enquiry form", with a long loop edge running under the whole map to reach it from "Invoice". Evidence: `s1-fit.png` (Bank transfer at x≈220,y≈650; Invoice at x≈1345), `s2-fit.png` (same shape). Cause visible in the JSON: the interview writes `n_bank -> n_owner` ("the person who sees it settle"), which pulls the payment step to the front of the layered layout. | The product's test is "who does what next, and what do they get" read without asking anyone. A cleaning-business owner or their client reads left to right and meets "paid" before "enquiry". The rest of the map is fine, which is why this is major, not blocker. | On the scenario 1 cleaning map re-rendered from `s1/suggested.json` (or an equivalent business-map run), "Bank transfer" sits to the right of "Invoice email"/"Invoice", and the happy path enquiry → quote → clean → job sheet → invoice → paid reads left to right with no step of the money leg drawn left of the enquiry form. |
| CTO-M2-02 | minor | look | Sublabels on suggested nodes are cut with an ellipsis at fit-to-view and when zoomed: "chases unanswered quot…" (Pipedrive), "invoice and reconcilia…" (Xero) in `s1-fit.png`, `s1-xero.png`; "Customer confirms…" in `s2-fit.png`. The card shows the full text, but the canvas does not. | The sublabel is the one line meant to say what the suggestion does; truncated it reads as noise beside a brand icon. | On the cleaning map, every node sublabel renders in full on the canvas at the fit and 100% zoom levels (either the renderer wraps/widens, or the skill's three-word rule is enforced on suggested nodes). |
| CTO-M2-03 | minor | look | Half the suggested nodes carry a brand mark (Google Calendar, Xero in `s1-fit.png`; Slack, Airtable, Twilio in `s3-fit.png`) and half render with the generic service glyph (Pipedrive, Jotform, Postmark). `sequentdraw catalogue --json` has `icon: null` for those three. | A client sees two visual classes of suggestion and reads the icon-less ones as less real or less specific; the purple border carries the meaning, so this is cosmetic. | Catalogue entries used as suggestions either have a brand icon where Simple Icons provides one (Jotform does), or a consistent, deliberate generic treatment is documented in `n8n-visual-style.md` and visible on the Pipedrive/Postmark nodes. |
| CTO-M2-04 | minor | purpose | The viewer has no legend: nothing on screen says that a purple border with "+" means "suggested, not in your business" or that a dashed grey node with "?" is an open question. The reader learns it only by clicking a node (`s1-focus.png` shows the purple "suggested" pill in the card). `grep -i legend src/n8n/render-shell.js` finds none. | The suggested/fact distinction is visible at a glance (met), but its meaning is not. A client shown the map cold could take Xero for something the business already uses. | The rendered map shows the meaning of the open and suggested styles without a click (a small legend, or the layer chips gaining "open (n)" / "suggested (n)" entries). |
| CTO-M2-05 | minor | purpose | When eval-build could not run the engine (blocked first run), its written summary stated the engine's gap rules "would not have covered the base/edge architecture anyway". The Medusa fixture has a `business` layer and, when I ran `check`, the engine reported three gaps (`refund_out` no recipient, `partial` and `cancel` no owner) and drew three open nodes (`s3-fit.png`, right of "Refund issued" and beside "Partially returned"/"Cancel return"). Evidence: `s3-output.txt` closing section vs `s3/review.json`. | A review that misstates what the engine checks undermines the "engine facts vs. skill judgement" split the summary is supposed to make. Only observed in the blocked path, so minor. | In a blocked or partial run, the eval-build/grill-build summary says only that the engine did not run, and never asserts whether the gap rules apply until `check` has been executed on that map. |

Scenario judgements that produced no finding, for the record:
- Scenario 1 (suggestions): 4 suggestions (≤5), all from the catalogue, each `cites` real node ids including the open nodes they sit beside; no suggestion closes a gap (three open nodes remain and `check` prints `ok`). Tools are ordinary for a UK cleaning business (the owner has withdrawn budget/region reasoning per `suggestion-agent.md`, so I did not judge price).
- Scenario 2 (declined): "No integration or tool suggestions written, as asked"; 16-node map validates; three open questions drawn, including the engine-found "declined enquiry has no outcome".
- Scenario 3 (eval-build): balanced (five things that work, three ranked findings, four additions, no replacements), every finding names a node; patch applied first time; 5 notes cap respected.
- Scenario 4 (grill-build): nine ranked challenges across the five axes, three alternatives each with a two-sided trade-off note wired beside the node it would replace, "does this need n8n at all: mostly no", and a "what holds up" section, so it stays usable.

---

## Lead developer's disposition

| ID | Severity | Disposition |
|---|---|---|
| CTO-M2-01 | major | Fixed in this PR. Diagnosed below: the cause is the shape of the edges the interview writes, not the layout engine. |
| CTO-M2-02 | minor | Issue, deferred. |
| CTO-M2-03 | minor | Issue, deferred. |
| CTO-M2-04 | minor | Issue, deferred. |
| CTO-M2-05 | minor | Issue, deferred. |

### CTO-M2-01: what the measurement showed

Re-measured on the CTO's own `s1/suggested.json` with `layoutMap()`:

| Variant | `n_bank` x | `n_invoice` x | Reads left to right |
|---|---|---|---|
| As the interview wrote it | 240 | 2256 | no |
| Add `n_invoice -> n_bank`, keep everything else | 2480 | 2256 | yes |
| Add `n_invoice -> n_bank`, drop `n_bank -> n_owner` | 2256 | 2032 | yes |

The CTO named `n_bank -> n_owner` as the cause. It is not the whole of it: dropping
that edge alone does not move the payment step, and keeping it does no harm once the
spine is continuous. What places "Bank transfer" in column two is that its **only**
incoming edge is `n_customer -> n_bank`, and `n_customer` is the node the map starts
at. A layered layout ranks a node one step after its predecessors, so a step whose
only predecessor is the actor who starts the process is drawn at the start.

Two more measurements ruled out a layout fix. A greedy feedback-arc cycle break
(Eades–Lin–Smyth) in `topo.js` in place of the current first-appearance rule moved the
payment step only from x=240 to x=464, still far left of the invoice at x=2032, and no
choice of reversed edges can do better: the document genuinely says the payment step is
adjacent to the node the map begins at. The fix belongs where the shape is written.

The rule added to the interview is therefore: **the happy path is a chain of steps, and
every step carries an edge from the step before it.** An actor edge (actor → step) and a
delivery edge (step → actor) are extra information layered on that spine, never a
substitute for it.
