# CTO review — M1 — re-review round 2

- **Gate:** M1 — `git-map` end to end, plus the plugin scaffold, the `doc-map` static export, and the skill-eval CI job
- **Commit reviewed:** `83a970d` on `main`
- **Date:** 2026-09-17
- **Reviewer:** `sequentdraw-cto` (Fable 5.1), `re-review` mode, scoped to its own five open findings
- **Round 1:** `round-1.md` — ACCEPT WITH FIXES, 4 major and 3 minor findings

The report below is the CTO agent's output, recorded verbatim.

---

Verdict: ACCEPT WITH FIXES

## Summary

Four of the five findings are resolved and I confirmed each by running the CLI against `83a970d` and reading the rendered output, including one nested git-map run that produced a voting map reading vote → redis → worker → db → result with the seed dependency dashed. The one that is not clean is CTO-M1-04: note placement itself is now good and the 822px connector to Mark received is acceptable, but the fix introduced a new connector from the silent-notification note to `no_notification` that is drawn straight through the Event bus node and its label — a connector cutting through an unrelated node is the same mis-attribution problem the finding was about, just in a new form. That is a small, local layout fix (route the connector around the node, or place the note above `no_notification`), so M1 should close as soon as it lands; nothing else needs to reopen. One aside for the owner, not a finding: scanning the live checkout (which carries four stale `.claude/worktrees/agent-*` copies) yields 80 entries with every component listed five times; the clean tree gives the promised 16.

## Re-review results

| ID | Status | Note |
|---|---|---|
| CTO-M1-01 | resolved | `scan` of a `git archive HEAD` export → `r2-self-clean-bundle.json`: 16 entries, `exclusions` = evals (test-directory), examples (example-directory, ambiguous:true), tests (test-directory); 0 fixture/test/example/eval-pathed entries. `component` evidence names `sequentdraw` plugin (`.claude-plugin/plugin.json`), `src/render-html.js` (library), `bin/sequentdraw` (cli), `doc-map` and `git-map` (skills). Aside only: the live checkout with stale `.claude/worktrees/*` gives 80 entries (5× duplicates); `r2-self-bundle.json`. |
| CTO-M1-02 | resolved | `r2-voting-bundle.json`: `data-access` ev37 vote→redis push (write), ev41 worker←redis pop (read), ev42 worker→postgresql (write), ev34 result←postgresql select (read); every `depends-on` carries `role:"deployment"`; 0 `sut`, 0 vote→db, 0 result→redis. Nested git-map run (171s, `founder-run2/run.log`, `check` printed `ok`) drew edges vote→redis, redis→worker, worker→db, db→result solid and seed→vote dashed. Screenshot `founder-run2/voting-map-2x.png`: reads left to right Vote intake → Queue and worker → Results; only open node is "Seed traffic? direction unknown", which is honest. |
| CTO-M1-03 | resolved | `biz.svg` and `map.html`: 0 occurrences of `…` and `...` (grep). Crops `r2-biz-crop-left.png`: 15-word Merchant description and 11-word Admin API description render in full under the node; `r2-biz-crop-refundnote.png` / `r2-biz-crop-bottomlabels.png`: 43-char "Return id and the items approved for refund", "Email or SMS update on the return's status", "Per-item inspection outcome for every returned SKU" all render whole, no clipping. |
| CTO-M1-04 | regressed | Placement is good: n_refund_cap, n_consider_partial_timing, n_ship, n_inspection sit directly beside/above their targets (`r2-map-crop-payment-fulfil.png`, `r2-map-crop-orderdomain.png`). The 822px gold dotted connector n_consider_refund_timing → Mark received is acceptable: it is a distinct style, crosses only a group frame and one edge, and terminates on the node (`r2-biz-crop-refundnote.png`). But `r2-map-crop-nonotif-3x.png` shows the connector n_consider_silent_notification → `no_notification` drawn straight through the Event bus node body and through the "Event bus / Redis" label; at a glance the note reads as attached to Event bus. Cosmetic in addition: in `biz.svg` the Inspection note straddles the Fulfillment group's top border (`r2-biz-crop-inspection.png`). Fix: route that connector around the node or place the note adjacent to `no_notification`. |
| CTO-M1-05 | resolved | `r2-voting-bundle.json` worker/: ev43 `runtime net7.0` (dotnet), ev44 `StackExchange.Redis 2.2.4`, ev45 `Npgsql 4.1.9`, ev46 `Newtonsoft.Json`, ev41/ev42 data-access, plus compose/build-context/CI entries — 12 worker entries; `findings: []`; CI-only `docker-compose.images.yml` and `result/docker-compose.test.yml` listed in `exclusions`. The generated map labels the node "worker — .NET 7 consumer" with no gap note (`founder-run2/voting-map-2x.png`). |

---

## Lead developer's notes

Both consequential claims were re-verified independently before any fix work began.

**CTO-M1-04's regression is real, and it was mine.** The round-1 fix cured distance and introduced crossing. Read from the CTO's 3× crop (`r2-map-crop-nonotif-3x.png`): the gold dashed connector rises from the note's top edge, crosses the Event bus node body over the Redis logo, clips the "Redis" sublabel, and terminates at the `no_notification` handle. A reader attributes the note to Event bus. Same defect, new cause.

**The "aside" understates the problem.** Measured on the live checkout: **80 entries, 64 of them from `.claude/worktrees/`**, with every component counted five times (`sequentdraw` ×10, `src/render-html.js` ×5, `doc-map` ×5, `git-map` ×5). The bundle's own `exclusions` array shows the mechanism — the scanner walks *into* each worktree and excludes that copy's `evals`/`examples`/`tests`, never the worktree itself. This is not specific to this repository or to agent worktrees: any user who runs `git worktree add ./wt`, or keeps a vendored checkout inside their project, has their architecture drawn N times, and `check --evidence` passes it because every duplicate cites real evidence. Same class as CTO-M1-01 — real evidence, wrong subject. Filed as issue #34.

Disposition:

| Finding | Status | Disposition |
|---|---|---|
| CTO-M1-01 | resolved | closed |
| CTO-M1-02 | resolved | closed |
| CTO-M1-03 | resolved | closed |
| CTO-M1-04 | regressed | fixed in this PR — connector now routes around obstacles |
| CTO-M1-05 | resolved | closed |
| Scan walks into nested worktrees | new, out of scope for the gate | issue #34 |
| `n_inspection` straddles the Fulfillment frame border | cosmetic, raised alongside CTO-M1-04 | issue #36 |

Issue #36 records a measurement worth keeping: the obvious fix for the straddle removes it in the business export but turns **0 connectors / 24px worst gap into 2 connectors / 256px worst gap** in the `--layers edge` export. It also exposes that the existing proximity tests *permit* a connector, so they do not catch quality lost that way.

Verified by the lead developer on this branch, independently of the authoring agent:

- own geometric segment/rect check on the Medusa layout: **2 connectors, 0 crossings through any other node**
- `tests/n8n-note-proximity.test.js`: 20 tests, 20 pass
- placement unchanged — connector counts (2 interactive, 1 business SVG, 2 all-layer SVG) and worst gaps (822px interactive, 928px all-layer SVG) identical to `main`, so CTO-M1-04's round-1 outcome is intact

The gate closes when this PR merges. M1 has had two rounds; the procedure in `CLAUDE.md` allows three before escalation.
