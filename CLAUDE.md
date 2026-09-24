# SequentDraw — working agreement

Instructions for any Claude session working on this repository. User-facing plugin
context lives in `AGENTS.md` and `skills/`, not here.

## Scope

Sessions on this project work on SequentDraw only.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Owner | The repository owner | Product direction and final say |
| Lead developer and reviewer | Opus (the main session) | Plans, orchestrates, reviews every change for correctness and security, merges |
| Workers | Subagents matched to the task | Haiku for bulk search and extraction; Sonnet for research and implementation; the reviewer agent for code review |
| CTO | `sequentdraw-cto` agent on Fable 5.1, low effort | Judges at milestone gates whether the product works, looks and feels right, and meets its purpose |

## How work lands

1. Every change goes through a pull request into `main`. Nothing is committed to
   `main` directly.
2. **The lead developer owns every PR.** It reviews each one (delegating code review
   for non-trivial changes) and then decides: merge it, or reject it with a reason.
   Workers never merge.
3. CI (`npm test`) must pass before merging. Skill PRs also need
   `claude plugin validate --strict` and passing skill evals
   (`docs/design/skills-and-plugin.md`).
4. Any GitHub repository that informs the output is credited in `CREDITS.md`, with its
   licence checked. Nothing from n8n's source, styles or assets is copied (Sustainable
   Use License).

## Milestone gates (CTO review)

The CTO is deployed **only** at these gates. It is never used for routine PRs, code
review or ad-hoc checks. It never reviews an open PR: it reviews `main` after the
lead developer has merged the milestone.

| Gate | Reached when this is merged | Scope |
|---|---|---|
| M1 | `git-map` (extraction Mode A, plugin scaffold, skill eval CI) | `git-map` end to end: install the plugin, map a real repository, open the map |
| M2 | The suggestion agent (`business-map` with suggestions, `eval-build`, `grill-build`) | Those three skills end to end on realistic business scenarios |
| M3 | The whole build order | The final product across Claude Code, Codex, the CLI and the MCP server, re-tested end to end by the lead developer against the repository's own fixtures and examples |

Procedure:

1. The lead developer merges the milestone PR into `main` under the normal rules above.
2. The lead developer briefs the CTO in `initial` mode on that `main` commit (SHA):
   milestone, scope, how to run, the scenarios to try, artifact paths, a scratch
   directory, and any limit on nested `claude -p` runs.
3. The lead developer fixes every `blocker` and `major` through new PRs that it owns and
   merges, and logs each `minor` as a GitHub issue. The CTO report is committed to
   `docs/reviews/<gate>/round-<n>.md` in the first fix PR, or in a docs PR if no fixes
   are needed.
4. The CTO runs in `re-review` mode on the new `main` commit, with only its open
   findings and what changed for each. It assumes everything else is correct and does
   not re-check the rest.
5. The gate passes on `ACCEPT`, or on `ACCEPT WITH FIXES` once those fixes are
   re-reviewed as resolved.
6. No work toward the next gate merges while a `blocker` from the current gate is open.
7. If a gate has not passed after three re-review rounds, the lead developer stops and
   escalates to the owner with the open findings.

### The CTO is internal, and is removed before completion

The CTO review is an internal quality check, not a product feature. The owner requires
it to be gone before the work is complete:

- **Until then, it never ships.** Packaging (npm `files`, the plugin manifest,
  `skills install`) must exclude `.claude/`, `CLAUDE.md` and `docs/reviews/`. No skill,
  hook, doc for users, or `AGENTS.md` mentions the CTO.
- **After M3 passes, a final cleanup PR** deletes `.claude/agents/sequentdraw-cto.md`
  and `docs/reviews/`, and removes the CTO rows, the milestone-gate section and this
  subsection from `CLAUDE.md`, plus the gate paragraph from `docs/HANDOVER.md`. The
  work is not complete until that PR merges.

## Where things are

- Product and build order: `docs/HANDOVER.md`
- Schema: `docs/SPEC.md`
- Visual design: `docs/design/n8n-visual-style.md`
- Skills, plugin and skill evals: `docs/design/skills-and-plugin.md`
- Credits and licences: `CREDITS.md`
