# CTO review — M2 — re-review round 2

- **Gate:** M2 — the suggestion agent
- **Commit reviewed:** `aa2bce7` on `main` ("fix: the happy path reads left to right (CTO-M2-01) (#53)")
- **Date:** 2026-09-19
- **Reviewer:** `sequentdraw-cto` (Fable 5.1), `re-review` mode, scoped to CTO-M2-01
- **Open findings at the start of the round:** CTO-M2-01 only. CTO-M2-02, -03, -04 and -05 were accepted as `minor` and deferred to issues #54, #55, #56 and #57.

The report below is the CTO agent's output, recorded verbatim.

---

Verdict: ACCEPT

## Summary

The one open finding is resolved. A fresh `business-map` run on the verbatim scenario 1 prompt (commit `aa2bce7`) now writes the happy path as a chain with `n_invoice -> n_bank`, and the rendered map reads left to right: enquiry form → accept/decline → send quote → customer confirms → schedule cleaner → clean property → job sheet → email invoice → invoice → bank transfer. "Bank transfer" sits at x=2256, right of "Invoice" (x=2032), and nothing from the money leg is drawn left of the enquiry form (x=240). With CTO-M2-02 to -05 deferred as minors, the milestone has no open blockers or majors and is ready to close.

Evidence (all under the session scratch directory `.../scratchpad/cto-m2-r2/`):
- `s1-output.txt` — the run's transcript (one nested `claude -p`, completed end to end, no retry needed)
- `s1/suggested.json`, `s1/gaps.json`, `s1/map.html` — the run's own outputs
- `s1-positions.txt` — `layoutMap()` node boxes sorted by x (n_form 240, n_decide 464, n_quote 688, n_confirm 912, n_schedule 1136, n_clean 1360, n_jobsheet_step 1584, n_invoice_step 1808, n_invoice 2032, n_bank 2256, n_owner 2480)
- `s1-fit.png` — fit-to-view; `s1-zoom-money.png` — 2x crop of the invoice → bank transfer leg

## Findings

None new (re-review mode; nothing else checked).

## Re-review results

| ID | Status | Note |
|---|---|---|
| CTO-M2-01 | resolved | Acceptance condition met on a fresh run, not a re-render of the old JSON: the edge list carries `n_invoice -> n_bank`, Bank transfer is right of Invoice, and the enquiry → paid story reads left to right at fit and zoomed. One observation for the record, not a finding: because "Owner" now hangs off "Bank transfer" (`n_bank -> n_owner` kept) and also feeds four earlier steps, it lands at the far right (x=2480) with its four participation edges drawn as loop-backs under the map. That is the actor hanging off the chain as the new interview rule intends, the loops do not cut through any node, and the spine is unaffected; a reader can still answer "who does what next" without asking. If the owner's participation edges are ever revisited (they could hang the actor beside its first step instead), that would be a cosmetic issue at most. |

---

## Gate outcome

**M2 passes.** `ACCEPT`, no blockers and no majors open. Work toward M3 may merge
from here, starting with build step 7a (correction mode).

The CTO's observation about an actor that both feeds early steps and receives the
last one is logged as issue #59 for the owner to judge — it is cosmetic, and the
alternative (hanging an actor beside its first step) would change how every business
map is written.

Round 1, with all five findings and the disposition of each, is in
[`round-1.md`](round-1.md).
