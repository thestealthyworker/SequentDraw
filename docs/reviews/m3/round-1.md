# M3 review, round 1

- **Gate:** M3, the whole build order
- **Commit reviewed:** `864752e` on `main` ("docs: step 8 and 8b done; status table matches what is built (#91)")
- **Date:** 2026-09-26
- **Reviewer:** the lead developer (Opus 5.5), per the owner's decision of 2026-09-24. There is no CTO run for this gate.
- **Scope:** the final product across the Claude Code plugin, the CLI, the MCP server and `skills install`, tested against the repository's own fixtures and examples plus one public repository.

Verdict: **ACCEPT.** No blocker and no major. The three minors are logged as issues and listed below.

Each check below says what was run and what it showed. Nothing here is taken from a test file's own claims.

## 1. The Claude Code plugin, in a real host

One headless `claude -p` session (Claude Code 2.1.283, `--plugin-dir` pointing at this checkout, model Sonnet 5), in an empty scratch directory, with the prompt *"Map the architecture of https://github.com/dockersamples/example-voting-app"*. Its stream-json output was timestamped line by line.

- **The skill fired on its own:** the `Skill` call `sequentdraw:git-map` at 10.4s.
- **The bundled MCP server connected:** the session's init message lists `plugin:sequentdraw:sequentdraw` with status `connected`, and all six tools (`sequentdraw_render`, `_validate`, `_scan`, `_check`, `_catalogue`, `_licences`).
- **The map is right.** It has six nodes: vote (Flask), redis, worker (.NET), db (Postgres), result (Express) and seed. It has five edges: `vote>redis`, `redis>worker`, `worker>db`, `db>result` and `seed>vote`. That is the voting app's real data flow. Every node cites scan evidence, and a re-check with the bundle enforced (`check map.json --evidence bundle.json`) prints `ok`.
- **The run cost $0.86** in two top-level turns, with the fork running inside them.

The full suite of skill evals, all six skills, passed on PR #89's final commit: 23m27s, 14 turn-limit stops, all tolerated by the guard. PR #88's run covered the new `business-map-output-tour` case. No skill has changed since. Together these are the end-to-end runs for `business-map`, `doc-map`, `eval-build`, `grill-build` and `gitrepo-suggest`, so they were not repeated.

## 2. Time to the first map (#25)

The same run, measured from process start:

| Moment | Time |
|---|---|
| `git-map` invoked | 10.4s |
| Scan written (`wrote .../bundle.json (46 evidence entries)`) | 23.9s |
| Map checked and saved (`wrote .../map.json (0 open nodes)`) | 114.3s |
| **Map rendered** (`wrote .../map.html (129kb)`) | **129.7s** |
| Final answer | 176.2s |

The first map arrives in 2m10s, down from the 5m32s the issue reported, and the whole run takes 2m56s. The engine is not the cost. A standalone `scan` of the same GitHub URL takes 1.49s, and the fixtures scan in 0.33–0.36s each. Most of the time is the model: 85s between reading the schema and writing the map.

Intermediate output exists, but only as tool descriptions: "Scan the example-voting-app GitHub repo into an evidence bundle", "Confirm the saved map file passes evidence check", "Render the saved map to an HTML fragment". The forked skill emitted no progress text of its own, despite the "say where you are" instruction from #83, and the 85s composition step is silent. That is finding M3-02.

## 3. The CLI, end to end

- `validate examples/medusa-return-flow.json`: `ok`.
- `render` to HTML: 242kb. `render` to SVG: 35kb.
- `check --emit-open`: four gaps, each with the question to ask, written as four open nodes.
- `catalogue`: 76 entries, and `--json` parses.
- `scan` on the fixtures `compose-app`, `next-supabase-stripe` and `polyglot`: 15, 12 and 47 evidence entries.
- `scan .`, SequentDraw itself: 25 entries, in 0.47s.
- `licences sindresorhus/slugify`: 1 usable.
- `--help`: exits 0.

## 4. The MCP server

It connected in a real host (section 1). By hand, over stdio, during the review of #89:
- `initialize` negotiates `2025-11-25`, and `validate` answers `ok`.
- A leading-dash `out` is refused with `-32602`.
- A `token_env` argument is rejected as unknown. It had been found sending an arbitrary environment variable to GitHub, and that was fixed before merge.

The worker's 19 tests spawn the real server and cover parity with the CLI.

## 5. `skills install`

Installed for Codex and then for Cursor into a scratch project, by hand, twice during the review of #90:
- Six skills were installed, each with a marker file.
- Every copied `SKILL.md` carries the "Installed copy" block right after its frontmatter.
- The literal engine command written into the copies (`node ".../bin/sequentdraw"`, a path with a space, double-quoted) ran `validate` → `ok`.
- The Cursor install warned about the duplicate Codex copies.
- Installing into this repository refuses its own `.agents/skills` symlinks.

## 6. The viewer, in a real browser (Chromium via Playwright)

A 256kb map: the Medusa example plus a 4-step tour written through `check --merge`.

- **Tour:**
  - The button reads "Take the tour 4 steps".
  - Each step shows "Step n of 4": 3 nodes focused, 41 dimmed.
  - Back is disabled on step 1, and the last step's button reads "Finish".
  - Finishing hides the panel and leaves 0 dimmed elements.
  - **Every node's coordinates are identical before and after the tour.**
- **Layers:**
  - Base (19) is locked on (the checkbox is disabled, by design).
  - Edge cases takes 44 visible nodes to 33, Business to 33, Build to 41.
  - Each toggle restores all 44 when switched back on.
- **Details card:** keyboard focus on "Ship items back" opens it, with the full description, tags, "Receives from" and "Sends to". Screenshot checked.
- **Legend:** "Open question (4)" is shown.
- **Export SVG:** `medusa-order-return-rma-flow.svg`, `image/svg+xml`, 109,894 bytes.
- **Export PNG:** `medusa-order-return-rma-flow.png`, `image/png`, 2,055,575 bytes.
- **Correction mode:** the toggle sets `is-correcting` and clears it again.
- **Console:** no errors from the page. The only error was the test server's missing `favicon.ico`.

When a tour ends, the camera goes to the default opening view (`scale(0.625)`), not to the view the reader had before starting (`scale(0.297)` after "fit"). That is finding M3-03.

## 7. Packaging

`npm pack --dry-run` ships 132 files (270,669 bytes). None of them is under `.claude/`, `docs/reviews/`, `evals/`, `tests/` or `review-outputs/`, and `CLAUDE.md` is not included.

No skill, hook, manifest, `AGENTS.md`, `README.md`, `bin/` or `schema/` file mentions the CTO or `docs/reviews/`. Nine source files under `src/` do, in code comments, as finding IDs such as "CTO-M1-02". That is finding M3-01.

## Findings

| ID | Grade | Finding | Evidence | Disposition |
|---|---|---|---|---|
| M3-01 | minor | Nine `src/` files cite internal review finding IDs ("CTO-M1-01" and similar) in comments, and `src/` ships in the npm package. | Section 7; `grep -rIl 'CTO' src` lists `scan/exclusions.js`, `scan/evidence.js`, `scan/check-evidence.js`, `scan/parsers/{csproj,compose,component,data-access}-parser.js`, `n8n/note-connector.js`, `n8n/sublabel.js`. | Folded into the step 9 cleanup PR, which removes the CTO: the comments keep their reasoning and cite the GitHub issue or PR instead. |
| M3-02 | minor | The forked `git-map` skill emits no progress text, so the only progress a user sees is the tool descriptions, and the 85s spent composing the map is silent. | Section 2. | Issue #92. #25 is closed on the measurement: 2m10s to the first map. |
| M3-03 | minor | Leaving a tour returns the camera to the default opening view rather than the reader's own view. Layers are restored exactly, but the camera is not. | Section 6: before `scale(0.297)`, after exit `scale(0.625)`. | Issue #93. |

No blocker or major, so no fix PR is required for the gate. With the report committed, M3 passes, and step 9 follows.
