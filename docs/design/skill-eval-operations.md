# Running the skill evals without overspending

Status: **measured**, 2026-09-18. Numbers come from the runs named below, not from
estimates.

## What a run costs

| Run | Head | Cases | Wall clock | Cost | Outcome |
|---|---|---|---|---|---|
| 35168611907 | `chore/eval-budget…` | 17 | 38 min | $8.59 | pass |
| 35176295107 | `e837337` | 30 | 88 min | $15.62 | session limit hit mid-run |
| 35190646425 | `73e4e77` | 30 | 23 min | $18.88 | 29/30 |
| 35193167016 | `1c11bad` | 30 | 15 min (aborted) | $14.19 | org monthly spend limit hit |
| 35214567992 (attempt 2) | `e12313e` | 30 | 21 min | $17.96 | 29/30 |
| 35218…(PR #50 final) | `83fe1b0` | 30 | 19 min | — | pass |

`--concurrency 4` is what took the suite from 88 minutes to about 20. The three
map-building output cases are most of the cost; the trigger and no-trigger cases are
cents each.

Two limits exist, and they are different things:

- `--max-cost-usd` (50) is a cap this suite enforces on itself. A run that reaches it
  stops with partial results.
- The account's own limits are not ours to control: a per-session limit ("You've hit
  your session limit · resets …") and an org monthly spend limit ("ask your admin to
  raise it"). Both killed a run mid-flight. Retrying does not help; only the owner
  raising the limit, or waiting for the reset, does.

## What actually wasted runs

Every failure that cost a rerun came from the sandbox's narrow grant, not from a bug a
user would see. CI runs `claude plugin eval` with `--allow-tools "Bash(node:*)"`, which
matches by command **prefix**, and the agent has no file-writing tool.

Refused, each one measured in a trace:

- a heredoc whose body is a JSON object, even `{"hello":"world"}`;
- any variable in the program path, including `node "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" --version`;
- `cd … &&`, `mkdir`, `touch`, `tee`, `echo … >`, and `bash scripts/sequentdraw.sh`;
- a `printf` body carrying raw apostrophes or backticks, because the quoting breaks.

Allowed: `printf '%s' '<json>' | node /literal/abs/path/bin/sequentdraw …`, including a
4,555-character document, and every `node /abs/path/bin/sequentdraw …` form. The rules
the skills follow are in `skills/*/references/cli-pipeline.md`, one shared file.

A refused command is not a denied shell. Two runs concluded Bash was off and gave up;
the same session had already run `node --version`. The skills now say so.

## Rules for the next change

1. **One PR, one run.** Batch skill changes. Do not push a fix and a follow-up
   separately if they can land together.
2. **Let the selection work.** `scripts/select-eval-tags.js` maps changed paths to
   `--tag <skill>`; only a change under `hooks/` or `.claude-plugin/` runs the full
   suite. Engine, workflow and script changes run nothing unless the PR carries the
   `run-evals` label (PR #87), which an engine PR that changes the CLI's output or
   options should carry. Docs-only changes run nothing.
3. **Prove the command forms locally first.** Every form a skill tells the model to run
   can be run by hand from a bash script. Do that before spending a run.
4. **Write grader patterns from real output**, and test them offline against a saved
   trace plus the skill text, which must not match. `scratchpad/regex-harness.js` is
   that harness.
5. **Never run `claude plugin eval` locally** on the 8GB machine.
6. **Read the traces before changing anything.** `--keep-temp` plus the trace-collection
   step means every failure has a transcript; `gh run download <id>` fetches it.
