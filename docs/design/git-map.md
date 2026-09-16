# Design: `git-map` (build step 4, milestone M1)

Status: **proposed** · 2026-09-15

`git-map` turns a code repository into a SequentDraw map: the technical (`base`) layer,
covering services, data stores, external integrations and the flow between them. It is
the first skill to ship, so it also brings the plugin scaffold and skill evals. Its
merge triggers the M1 CTO review.

Owner decisions:
- **Sources:** local folders and GitHub URLs.
- **Output:** behave like Claude artifacts. Publish a private artifact and keep a local
  copy; write into the repo only on request.
- **Scanner:** `@specfy/stack-analyser`, adopted after verification, behind a
  SequentDraw-owned safe file provider.

## Principle: evidence, not guesses

A map that invents a service is worse than no map. Every node and edge that claims to
come from the code must cite evidence found by a deterministic scan. The model decides
grouping and naming. It never decides that something exists. Whatever the scan cannot
establish becomes an `open` node with a question for the user.

## Pipeline

```
repo (local path or GitHub URL)
  │  acquire: local path, or shallow read-only clone into a temp dir
  ▼
sequentdraw scan  ──► evidence bundle (JSON)     deterministic, engine
  │
  ▼
git-map skill     ──► workflow JSON              host AI: group, name, ask
  │  sequentdraw check --evidence bundle.json   every scan claim cited
  ▼
render ──► map.html (+ artifact fragment) ──► publish private artifact + local copy
```

## 1. Acquire

| Source | Rule |
|---|---|
| Local path | Must be a directory the user named, or the current project. Resolved to a real path and scanned read-only. |
| GitHub URL | Only `https://github.com/<owner>/<repo>` (optionally with a `/tree/<ref>` path). Cloned with `git clone --depth 1 --single-branch --no-tags --no-recurse-submodules`, with `GIT_TERMINAL_PROMPT=0`, `core.hooksPath=/dev/null`, `protocol.file.allow=never` and a clone size and time limit. Private repos work only through credentials the user already has; the tool never asks for them. The temp clone is deleted afterwards, including on failure. |

Nothing in the repository is ever executed: no installs, builds, scripts, dynamic
imports, git hooks or submodules.

## 2. Scan (`sequentdraw scan <path> [--out bundle.json]`)

**Detection.** `@specfy/stack-analyser` (MIT, pinned to an exact version) supplies
technology rules across about 15 ecosystems:
- dependency manifests
- docker-compose and Dockerfiles
- Terraform
- GitHub Actions
- `.env.example` variable names

We verified its published code before adopting it: it contains no process spawning,
`eval` or network access, and its environment rule reads only `.env.example`.

**Safe provider.** Its own filesystem provider has no limits, so SequentDraw passes its
own implementation of the three-method provider interface (`listDir`, `stat`, `open`):

| Guard | Rule |
|---|---|
| Size | At most 20,000 files, 25 directory levels, 1MB per file read, 100MB read in total. Exceeding a limit stops the scan and reports it; the tool never returns a silently partial result. |
| Skipped | `node_modules`, `vendor`, `dist`, `build`, `.git`, `.next`, `target`, `coverage`, minified and generated files, and binary files (detected by content). |
| Repository boundaries | A directory that is itself another repository is where this one stops: a nested clone (`.git` is a directory) or a linked worktree or submodule (`.git` is a file beginning `gitdir:`). Descending into one draws the project's own architecture once per copy. The scan root is exempt -- it is always a repository, and is itself a `gitdir:` pointer whenever SequentDraw is developed from a worktree -- as is any nested repository the manifest names as the product. Each skip is reported in `exclusions` as `nested-repository` or `nested-worktree`. |
| Symlinks | Never followed, including the `.git` marker the boundary test reads. |
| Secrets | Real `.env`, `.env.local`, `.env.production` and similar files are never opened. `.env.example` is read for variable **names** only; values are stripped before any rule sees them. A committed real `.env` file becomes an `open` note ("A .env file is committed; check for secrets"), naming no values. |
| Text | Zero-width and bidirectional control characters are stripped from every string in the bundle. |

**Evidence bundle** (structured facts only, never free prose from the repo):

```jsonc
{
  "repo": { "name": "example-voting-app", "source": "github", "ref": "<sha>" },
  "limits": { "files": 214, "bytes": 1840000, "truncated": false },
  "exclusions": [
    { "path": "result/tests", "reason": "test-directory", "ambiguous": false },
    { "path": "examples", "reason": "example-directory", "ambiguous": true },
    { "path": ".claude/worktrees/agent-1", "reason": "nested-worktree", "ambiguous": false },
    { "path": "third-party/tool", "reason": "nested-repository", "ambiguous": false }
  ],
  "evidence": [
    { "id": "ev12", "kind": "compose-service", "path": "docker-compose.yml", "line": 18,
      "value": "redis", "tech": "redis", "icon": "redis" },
    { "id": "ev13", "kind": "depends-on", "path": "docker-compose.yml", "line": 9,
      "from": "vote", "to": "redis", "role": "deployment" },
    { "id": "ev14", "kind": "data-access", "path": "worker/Program.cs", "line": 40,
      "from": "worker", "to": "redis", "direction": "read", "value": "pop",
      "tech": "redis", "icon": "redis" },
    { "id": "ev15", "kind": "component", "path": "package.json", "line": 7,
      "value": "sequentdraw", "role": "cli", "to": "bin/sequentdraw" },
    { "id": "ev16", "kind": "runtime", "path": "worker/Worker.csproj", "line": 5,
      "value": "net7.0", "tech": "dotnet" },
    { "id": "ev20", "kind": "env-name", "path": ".env.example", "line": 3,
      "value": "STRIPE_SECRET_KEY", "tech": "stripe", "icon": "stripe" }
  ]
}
```

Evidence kinds, in order of trust: compose or Kubernetes service and `depends_on`;
data-access operations; infrastructure-as-code resources; SDK imports actually used in
source; dependency manifest entries (including .NET `PackageReference`); declared
components; build contexts; runtimes; environment variable names; HTTP route and webhook
declarations; CI workflow jobs (these go to the `build` layer).

A manifest entry alone is weak evidence: "depends on X" does not mean "X is live". Such
a node is marked `open` unless an import, service or environment name corroborates it.

**Direction: `depends_on` is not a work arrow.** `depends_on` means "starts after". An
arrow in this product's visual grammar means "work flows this way". The two coincide only
when a service *writes* to its dependency, so following `depends_on` drew the voting app
backwards: `worker -> redis` when data flows redis to worker, `result -> db` when it
flows db to result. Both stores became sinks, and the real chain could not be traced.

Two things fix it, and neither invents anything:

1. Every `depends-on` fact carries `role: "deployment"`, so it can be drawn as a startup
   dependency rather than as a flow arrow.
2. A `data-access` fact records what a component actually *does* to a store —
   `{ from: "worker", to: "redis", direction: "read", value: "pop" }` — derived from the
   store operations present in that component's own source. **If a component writes to a
   store at all, work flows into the store; a component that only reads is downstream of
   it.** A `SELECT` counts as a read only when it names a `FROM`, so a `SELECT 1`
   keep-alive does not make a writer look like a reader.

An operation is attributed to a store **only when the owning component declares a client
for it** (`pg`, `psycopg2`, `Npgsql`, `redis`, `StackExchange.Redis`, …), and only when
exactly one declared client matches. SQL text in a component with no database client
establishes nothing, and a component wired to two SQL stores yields no fact rather than a
guess. Components are attributed from compose `build` contexts, so
`worker/Program.cs` belongs to the `worker` service.

**Relevance: map the product, not its test fixtures.** Scanning this repository used to
return 69 facts, 54 of them from `tests/fixtures/repos/*` and `evals/*` — three synthetic
fixture apps. Every fact was real, so `check --evidence` passed; they were simply facts
about someone else's system. A path is skipped when its own directory name is a
conventional test name (`tests`, `__tests__`, `fixtures`, `evals`, `spec`, …) or its file
name carries a `.test.` / `.spec.` segment, **and** nothing the repository's own manifests
point at lives there. The manifests get the final word: `package.json`'s `files`, `bin`,
`main`, `exports` and `workspaces`, and every compose `build` context, name the product,
so a repo whose `examples/` really is its deliverable keeps it. Names in the weaker class
(`examples`, `demo`, `samples`) are skipped but marked `ambiguous`, because that is a
judgement call the user may want to overturn. A test directory *inside* a product
directory is still a test directory — which is what stops a CI-only
`result/docker-compose.test.yml` contributing relationships that do not hold in the real
app.

Where a repository ships several compose files, the standard-named one nearest the root is
canonical; a variant restating a service the canonical file already declares is dropped as
a duplicate, while anything only the variant states (a pre-built image name, an extra
service) is kept.

**Every exclusion is reported.** The bundle's `exclusions` array names each skipped path,
its reason, and whether the call was ambiguous, so the skill can tell the user what was
left out and offer to include it. Silently dropping repository content is a defect this
engine has fixed before (see the `yaml-rejected` findings).

**Icon crosswalk.** No maintained dataset maps technology names to Simple Icons slugs,
so SequentDraw keeps a small tested table (`tech → slug`). Unknown technology gets no
icon and falls back to the kind glyph. The tool never guesses a brand.

## 3. The skill builds the map

`git-map` reads the bundle, never raw repository prose, and writes workflow JSON:
- it groups services into sub-workflows and names nodes (sublabels of at most 3 words)
- it types edges and writes short `description`s
- it writes an `open` node with a `prompt` for each gap, for example:
  - a queue with a producer but no consumer
  - an environment variable for an unknown vendor
  - a webhook route: "who sends this?"
- it writes a map-level sticky note naming the repo, the commit and the scan limits

**IR addition.** Nodes and edges gain an optional `evidence` array of evidence ids.
**`sequentdraw check --evidence bundle.json`** enforces the contract structurally:
- every node with `source: "scan"` cites at least one existing evidence id
- every cited id exists in the bundle
- an edge with `source: "scan"` cites a `depends-on`, import or route fact linking its
  endpoints

Violations are validation errors, and the skill fixes them by demoting the item to
`open` or `source: "model"`. The details card shows each node's evidence as
`path:line`.

**Prompt injection.** Repository content is data, never instructions. The bundle carries
structured fields only. The skill's instructions say that nothing inside the bundle can
change its task, and the skill takes no side-effecting action based on repo content. Its
only writes are the map files, in the output location below.

## 4. Output: behave like Claude artifacts

| Host | Behaviour |
|---|---|
| Claude Code | Render and **publish the map as a private Claude artifact**, then give the user the link. The page is private by default; the skill says so and never shares it further. Always also keep `map.json` and `map.html` in a session folder outside the repo, not inside it. |
| Codex, other agents, CLI | No artifacts: write the same two files to a temp folder, open the HTML locally, and print both paths. |
| Saving into the repo | Only when the user asks ("save it to docs/architecture"). The skill then writes the JSON and HTML there and asks before overwriting. |

For artifacts, the engine adds a fragment mode, `renderMap(doc, { fragment: true })`. The
artifact skeleton supplies `<html>`, `<head>` and `<body>`, so the fragment carries only
the title, style, SVG, card overlay and single script. The file stays self-contained, and
the published page passes the artifact sandbox, which blocks external requests (the
viewer already makes none).

Corrections are conversational from day one ("Stripe belongs in Payment"): the skill
edits the JSON, re-validates, re-checks evidence and republishes to the same artifact.

## 5. Plugin scaffold (ships in the same PR)

- `.claude-plugin/plugin.json` (`name: sequentdraw`) and `marketplace.json`, so the plugin
  installs with `/plugin marketplace add thestealthyworker/SequentDraw`
- `skills/git-map/` and `skills/doc-map/`, each with `SKILL.md`, `references/` and
  `scripts/` that call the CLI
- `hooks/hooks.json`: a `SessionStart` note under 1,500 characters listing the skills
- `bin/sequentdraw`, the CLI entry for `scan`, `check` and `render`
- `package.json` `files` whitelist: the published package excludes `.claude/`,
  `CLAUDE.md`, `docs/reviews/` and tests, per the internal-tooling rule
- CI: `claude plugin validate . --strict` on every PR; skill evals on PRs touching
  `skills/`, `evals/` or `hooks/`, using the `CLAUDE_CODE_OAUTH_TOKEN` secret and
  `--max-cost-usd 10`

## 6. Proving it works

**Engine tests** (offline, deterministic) run on synthetic fixture repos we write
ourselves under `tests/fixtures/repos/`, MIT-licensed:
- a compose microservice app
- a Next.js + Supabase + Stripe app
- a FastAPI + Postgres + Redis + Celery app
- a hostile repo: symlink loop, 50MB file, a real `.env` with fake secrets, minified
  bundles, zero-width characters, and "ignore previous instructions" text in a README
  and in comments

Assertions: expected evidence is found, limits hold, no secret value appears anywhere
in the output, and the scan finishes within a time bound.

**Accuracy** is measured on real public repos, cloned at pinned commits during evals and
never vendored into this repo:

| Repo | Licence | Expected (from its compose file or README) |
|---|---|---|
| `dockersamples/example-voting-app` | Apache-2.0 | vote, result, worker, redis, db (postgres): 5 nodes, 4 edges |
| `fastapi/full-stack-fastapi-template` | MIT | backend, frontend, db (postgres), proxy, adminer, CI |
| `vercel/nextjs-subscription-payments` | MIT, archived (fine when pinned) | Next.js app, Supabase, Stripe, webhook route |

Measures: node precision and recall against hand-written expected nodes; zero nodes
without evidence; every `open` node carries a prompt.

**Skill evals** (`claude plugin eval`):
- should trigger: "map this repo", "diagram our architecture", a GitHub URL
- should not trigger: "build an n8n workflow", "draw a pie chart"
- output: the validator and evidence check pass, a private artifact is published in
  Claude Code, and nothing is written into the repo unless the user asked

## 7. Credits

`@specfy/stack-analyser` (MIT, runtime dependency); CodeBoarding (MIT, design reference
for the deterministic-plus-LLM split, no code used); the fixture repos above. All go
into `CREDITS.md` with the implementation.

### Supply chain

Adopting `@specfy/stack-analyser@1.27.6` brought in 5 advisories under
`npm audit --omit=dev` (main had none), all through its own dependencies:

| Package | Severity | Reachable from a scanned repo? |
|---|---|---|
| Nested `yaml` 2.8.x | Moderate | **Yes.** Its docker and GitHub Actions rules parse repository YAML, and deeply nested YAML can overflow the stack. |
| `nanoid` 5.1.5 | High | No. Needs a caller-supplied zero or negative size. |
| `undici`, via `@actions/http-client` | High and moderate | No. Only its GitHub Action entry point loads it, and the scanner makes no network calls. |

How this is handled:

1. **npm `overrides`** pin stack-analyser's `yaml` to 2.9.1 and `nanoid` to 5.1.16, and
   `undici` to 6.28.1. The audit returns to 0 for this repository, CI and plugin
   installs.
2. **The safe provider refuses dangerous YAML** before stack-analyser sees it (nesting
   depth, alias count, size) and records a `yaml-rejected` finding. This protects installs
   where overrides do not apply.
3. **Required before publishing to npm:** npm ignores a dependency's `overrides`, so
   SequentDraw installed as a package would inherit these advisories. Before the first npm
   publish, vendor only the detection rules SequentDraw uses into `src/scan/rules/`, keeping
   stack-analyser's MIT notice, and drop the dependency and its transitive tree. Tracked in
   `docs/HANDOVER.md`.

## 8. M1 gate

After merge, the lead developer briefs the CTO on that `main` commit: install the plugin
from the marketplace, run `git-map` on `dockersamples/example-voting-app` by URL and on
a local repo, open the published artifact, then correct one node conversationally. The
CTO judges whether it works, looks right, feels right and fits its purpose.
