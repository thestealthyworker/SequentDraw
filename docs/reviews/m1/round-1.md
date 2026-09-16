# CTO review — M1 — initial

- **Gate:** M1 — `git-map` end to end, plus the plugin scaffold, the `doc-map` static export, and the skill-eval CI job
- **Commit reviewed:** `3eca89c` on `main` ("feat: Claude Code plugin with git-map and doc-map skills (#23)")
- **Date:** 2026-09-16
- **Reviewer:** `sequentdraw-cto` (Fable 5.1), `initial` mode
- **CI state at review:** skill-evals 10/10 cases at 1.00, `npm test` 624 passing, `claude plugin validate --strict` passing

The report below is the CTO agent's output, recorded verbatim.

---

Verdict: ACCEPT WITH FIXES

## Summary

The interactive map is ready: it is recognisably n8n, legible when zoomed, pan/zoom/fit and layer toggles all behave, and toggling a layer removes its edges, handles, notes and frame slack with no leftovers (business off: 40→30 nodes, 44→30 edges, zero edges left touching a hidden node). git-map works end to end for a founder: from `claude -p --plugin-dir` with one sentence, the plugin scanned `example-voting-app` in 2s and produced a credible, honest 10-node map in 5m32s with no questions asked, including a gap note where the scan could not identify the worker's runtime. Four things stop me calling it done: the scanner treats a repo's own test and eval fixtures as the product (50 of 69 findings on the self-scan), git-map's arrows follow compose `depends_on` rather than the flow of work, so a client reads the pipeline backwards, the doc-map figure truncates every single caption and edge label so it cannot be understood without hover (the one thing it exists for), and attached sticky notes land far from the nodes they annotate. None of these undermine the milestone's core, all are fixable, and the viewer needs no changes.

## Findings

| ID | Severity | Area | What I saw | Why it matters to users | Accept when |
|---|---|---|---|---|---|
| CTO-M1-01 | major | purpose | Self-scan of the SequentDraw checkout: 50 of 69 evidence entries come from `tests/fixtures/repos/{compose-app,fastapi-celery,next-supabase-stripe}/…` and `evals/git-map-output-compose-app/fixture/…` (ev4–ev15, ev24–ev69). The only entries about SequentDraw itself are 6 `package.json` deps and 3 CI jobs. Nothing names the render core, ELK, the scanner, the CLI, the plugin or the skills. | A founder who maps their own repo gets "web/api/worker/postgres/redis", "fastapi-celery" and "Stripe webhooks" drawn as their system. They would not recognise it, and the skill's own principle ("a map that invents a service is worse than no map") is broken by real-but-irrelevant evidence. | Scanning the SequentDraw checkout yields a bundle in which fixture, test, example and eval directories are excluded (or flagged so the skill omits them), and the resulting map's base layer shows SequentDraw's own components. |
| CTO-M1-02 | major | purpose | Founder run map: edges `worker -> redis` ("Polls votes off the queue"), `result -> db` ("Reads the live tally") point from the consumer into the store because they copy compose `depends_on`. Rendered layout puts "Vote intake" bottom-right and "Results" top-left; every arrow in the base layer ends at Postgres or Redis. | The map's job is "who does what next, and what do they get". A client reads this as Result sending to Postgres and Worker sending to Redis; the real pipeline vote → redis → worker → postgres → result cannot be read off the picture without opening cards. | For a compose-based repo, arrows follow the direction of data or work (or the edge is visibly labelled as a deployment dependency), so the voting app reads left-to-right as vote → queue → worker → store → results. |
| CTO-M1-03 | major | purpose | doc-map export `medusa-business.svg`: 29 of 29 node captions end in "…" ("Owns shipment state, including the…", "Evaluates the fulfillment…", "Stripe issues the refund to…"), and all 4 edge labels are cut ("Return id and the items approved for re…"). Source descriptions are only 66–102 chars; the 2-line caption strip fits ~35. | The figure exists for a slide or PDF where nobody can hover; captions cut mid-sentence give the reader less than the label already did. The doc-map skill's own 12-word draft rule (~70 chars) would also be truncated. | A description of the length the doc-map skill drafts (12 words) renders in full under its node, and edge labels of ~40 chars render in full, on the Medusa business export; no caption on that export ends in "…". |
| CTO-M1-04 | major | look | Interactive map `medusa-map.html`: measured in-page, note `n_consider_silent_notification` (attached to `no_notif`, `notif_mod` in Platform) sits 1192–1368 canvas px from both, directly above the Payment frame; `n_consider_refund_timing` sits 496–850 px from `mark_recv`/`pay_mod`; `n_refund_cap` 240 px from `refund_check`. The design rule is "placed beside the bounding box of the nodes it names". | Sticky notes are how skills explain and raise considerations. A reader attributes the notification note to Payment, not Notifications; consideration notes floating in empty space read as orphaned. | Every attached note on the Medusa fixture sits within one node-spacing (≤128 px) of the bounding box of its targets, or is visibly connected to them. |
| CTO-M1-05 | minor | purpose | `voting-bundle.json` (61 entries) has no entry for `worker/` (the .NET project's `Worker.csproj` with its Postgres and Redis client packages) and none for `k8s-specifications/`; the founder run had to add a note saying the worker's runtime is unknown. Compose services are also tripled across `docker-compose.yml`, `docker-compose.images.yml` and `result/docker-compose.test.yml`. | The one component a founder would most want explained is the one the scan cannot describe; duplicate compose evidence costs model time and invites duplicate nodes. | A scan of `example-voting-app` yields manifest or import evidence for the worker's data-store clients, and the map identifies its runtime without a gap note. |
| CTO-M1-06 | minor | feel | Fit-to-view on the 40-node Medusa map at 1440×900 renders labels at ~5 px (scale 0.317); the top ~28% of the viewport is empty except notes, because the fit box includes notes placed at y=-232. First impression is icons only until the reader zooms. | A founder's first glance at a mid-size map shows no readable words; n8n has the same trait, so this is acceptable but worth a nudge (e.g. fit to nodes, or a minimum readable start zoom for maps under ~15 nodes). | On open, the Medusa map's fit view has no more than ~15% empty band above the nodes, or the map opens at a zoom where labels are ≥10 px and pans to the entry node. |
| CTO-M1-07 | minor | feel | Cold start measured: 2 install commands, one sentence prompt; scan 2.2 s; total 5m32s to `map.html` on Sonnet for a 5-service repo. Output was correct first time and the report is clear and short. | Five-plus minutes for a tiny repo with no visible intermediate result is long enough that a founder may think it stalled; larger repos will take longer. | The skill prints the local `map.html` path (or a first render) within ~2 minutes for a repo of this size, or reports progress at each pipeline step. |

---

## Lead developer's notes

Two findings were re-verified independently before any fix work began:

- **CTO-M1-01 is understated.** The self-scan bundle has **54 of 69 entries (78%)** from `tests/fixtures/` and `evals/…/fixture/`, not 50 of 69. The entries describing SequentDraw itself are six `package.json` dependencies and three CI jobs.
- **CTO-M1-03 confirmed.** The business export contains **33 ellipsis characters**. All 40 node descriptions in `examples/medusa-return-flow.json` are 66–102 characters (median 85) against a caption strip fitting roughly 35, so every one truncates.

Disposition, per the gate procedure in `CLAUDE.md`:

| Finding | Severity | Disposition |
|---|---|---|
| CTO-M1-01 | major | Fix PR (scanner) |
| CTO-M1-02 | major | Fix PR (scanner) — approach approved by the owner: infer edge direction from each service's imports, and where import evidence is unavailable, keep the `depends_on` direction but mark the edge as a deployment dependency |
| CTO-M1-03 | major | Fix PR (renderer) |
| CTO-M1-04 | major | Fix PR (renderer) |
| CTO-M1-05 | minor | Fixed with CTO-M1-02 rather than deferred, because the import inference has no evidence to work from where the scanner's language coverage is thin |
| CTO-M1-06 | minor | Issue #24 |
| CTO-M1-07 | minor | Issue #25 |

The gate stays open until the CTO re-reviews these findings and records the result in `round-2.md`.
