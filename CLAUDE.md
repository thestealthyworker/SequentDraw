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

## How work lands

1. Every change goes through a pull request into `main`. Nothing is committed to
   `main` directly.
2. **The lead developer owns every PR.** It reviews each one (delegating code review
   for non-trivial changes) and then decides: merge it, or reject it with a reason.
   Workers never merge.
3. CI (`npm test`) must pass before merging. Skill PRs also need
   `claude plugin validate --strict` and passing skill evals
   (`docs/design/skills-and-plugin.md`). An engine PR that changes the CLI's output or
   options carries the `run-evals` label.
4. Any GitHub repository that informs the output is credited in `CREDITS.md`, with its
   licence checked. Nothing from n8n's source, styles or assets is copied (Sustainable
   Use License).

## Where things are

- Product and build order: `docs/HANDOVER.md`
- Schema: `docs/SPEC.md`
- Visual design: `docs/design/n8n-visual-style.md`
- Skills, plugin and skill evals: `docs/design/skills-and-plugin.md`
- Credits and licences: `CREDITS.md`
