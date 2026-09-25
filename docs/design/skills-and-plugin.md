# Design proposal: skills, plugin and evals

Status: **proposed** · 2026-09-15 · skill set defined by the owner

SequentDraw is meant to be driven by AI tools: Claude Code, Codex and other agents
call it through skills, an MCP server or a CLI (an HTTP API is deferred; see `docs/HANDOVER.md` step 8). This document settles
which skills exist, how they get triggered, how one skill set serves several agents,
and how we prove each skill works.

Facts below were checked on 2026-09-15 against the Claude Code docs
([skills](https://code.claude.com/docs/en/skills.md),
[hooks](https://code.claude.com/docs/en/hooks-guide.md),
[plugin evals](https://code.claude.com/docs/en/plugin-evals.md)), against
`claude plugin eval --help` on Claude Code 2.1.272, and against the Codex skills docs
and the open [Agent Skills](https://github.com/agentskills/agentskills) specification.

Terminology: **skill evals** are the automated tests that prove a skill works.
`eval-build` is a skill that evaluates a user's architecture. The two are unrelated.

## How triggering actually works

- **The model picks a skill from its description.** Claude, and Codex, see every
  skill's `name` and `description`. The body loads only when a skill is chosen.
  In Claude Code, `description` plus `when_to_use` is capped at 1,536 characters;
  anything beyond is truncated. Users can also call a skill directly as
  `/sequentdraw:<name>` in Claude Code or `$<name>` in Codex.
- **Hooks cannot invoke a skill.** A hook can inject text as additional context, or
  allow or block a tool call; nothing more. So a hook can remind Claude that a
  skill applies, but it cannot run one. Reliable routing comes from sharp
  descriptions, measured by skill evals, and hooks only add a nudge.
- **The engine is the source of truth.** Skills do not reason about layout or
  schema. They produce or edit workflow JSON, then call the engine to validate,
  check for gaps and render. Invalid output fails loudly in the engine, not quietly
  in prose.

## Skills

Six user-facing skills, as named by the owner. Skill names use lowercase and hyphens
(an Agent Skills naming rule), so `/Git-Map` becomes `/sequentdraw:git-map`.

| Skill | The user wants | Does |
|---|---|---|
| `git-map` | A map of a git repository | Scans the repo: services, data stores, integrations and the flow between them. Writes the technical layer, marks unknowns `open`, renders. |
| `business-map` | A map of a business idea or process | Interviews the user (about 8 questions tracing one unit of value from "work is needed" to "paid"). Writes business and edge layers with `open` gaps, then runs the suggestion agent: 3–5 n8n integrations as `suggested` nodes. Renders. |
| `eval-build` | A balanced review of the current architecture | Reads the existing map, building one with `git-map` first if none exists. Runs gap checks and the suggestion agent in review mode. Findings become `open` nodes and sticky notes; improvements become `suggested` nodes; plus a short written summary. |
| `grill-build` | A harsh critique with stronger alternatives | Same inputs as `eval-build`, but adversarial. Challenges each tool choice on lock-in, single points of failure, scaling and operational burden — never on price, cost or budget, which are the user's call. Proposes stronger alternative tools as `suggested` nodes beside what they would replace, each with a trade-off note. Also asks whether the business needs an automation platform at all. |
| `gitrepo-suggest` | Open-source code that could improve the design | For the map's weakest or most custom-built nodes, searches GitHub for relevant **MIT-licensed** repositories. Verifies each licence through the GitHub licence API (SPDX `MIT` exactly), checks activity and fit, and attaches candidates as sticky notes linked to the node. |
| `doc-map` | A static figure of a map for documentation, with no hover | Reads an existing map, asks which layers to include, and writes a minimal description (about 12 words, never more than 2 lines) for each included node that has none, marking them for the user to confirm. Exports an SVG with inline captions (`docs/design/n8n-visual-style.md`, "Documentation export"). Adds nothing else to the map. |

Shared capabilities, used by every skill rather than exposed as skills:

- **Rendering** (`sequentdraw render`): the n8n-style interactive HTML map, and the
  static SVG with inline captions.
- **Sticky notes**: explanations attached to nodes or groups in the `notes` array.
- **Gap detection** (`sequentdraw check`): completeness checks that emit `open` nodes.
- **Suggestion validation**: rationale present and citing existing nodes, pick from
  the n8n catalogue, at most 5 per map.

No dedicated tour skill (owner, 2026-09-25): `business-map` and `git-map`,
the two skills that build a map, offer a walkthrough once it is published
and write it on request (`skills/*/references/tours.md`).

### Rules every skill keeps

These come from the handover and the owner's decisions, and apply to all six skills,
`grill-build` included:

- **Output behaves exactly like an artifact published in Claude.** This holds for every
  skill that produces a map, figure or review. In Claude Code, the skill publishes the
  result as a **private Claude artifact** and gives the user the link. The page is
  private by default; the skill says so and never shares it further. It always keeps a
  **local copy** in a session or temp folder outside the repository (`map.json` and
  `map.html`, or the `.svg` for `doc-map`) and prints its path. It writes into the
  repository only when the user asks, and asks before overwriting. Hosts without
  artifacts (Codex, other agents, the CLI) open the local copy instead. Artifact pages
  cannot offer file downloads, so a file the user needs, such as `doc-map`'s SVG, comes
  from the local copy while the artifact shows the figure. Corrections republish to the
  same artifact.
- **Suggest, the user accepts.** Tools enter as `suggested`, never as `confirmed`.
- **Rationale is grounded in the map.** "Most teams use X" is not a rationale; "three
  long-running steps run synchronously" is.
- **Tools come from n8n's integration catalogue.** Open-source repositories from
  `gitrepo-suggest` are notes, not nodes, until the user adopts one.
- **Suggestions are workflow improvements, not financial advice.** No budget, price,
  cost or region reasoning: the user decides what fits their business (owner,
  2026-09-17). Popularity bias is guarded against by the graph instead: a suggestion
  must answer something the map actually shows, not whatever is common in training data.
- **Any repository that informs the output is credited.** When a
  `gitrepo-suggest` candidate is adopted, it goes into the project's credits.

### Boundaries

Each description states what the skill is not for, and skill evals assert it.

| Request | Goes to | Not |
|---|---|---|
| "Review my architecture" | `eval-build` | `grill-build`, which is only for explicit asks: grill, harsh, brutal, stress-test, tear apart |
| "Suggest integrations for this map" (a map exists, no review asked) | `eval-build` | `business-map`, `grill-build` |
| "Grill me on this plan" (no build or map involved) | Not SequentDraw; general grilling skills handle it | `grill-build` |
| "Build me an n8n workflow that emails leads" | n8n's own skills; SequentDraw designs flows, it does not deploy them | any SequentDraw skill |
| "Find a library for PDF parsing" (no map) | Not SequentDraw | `gitrepo-suggest` |
| "Map this repo" vs "map my business" | `git-map` vs `business-map` | each other |
| "Give me an image of this map for our docs", "export the workflow for a slide" | `doc-map` | any skill that changes the design |
| "Draw a map of our repo for the docs" (no map exists yet) | `git-map` first, then `doc-map` | `doc-map` alone, which never invents structure |

`business-map` runs inline and never as a forked subagent, because it is a
conversation with the user. `git-map` runs as `context: fork`, because it reads
code without needing the user.

#### Decision: `git-map` keeps `context: fork` (issue #51, 2026-09-17)

Issue #51 asked whether a forked `git-map` can use Bash at all under the narrow
`Bash(node:*)` grant the skill evals run with. The two CI traces of
`git-map-output-compose-app` (eval run 35214567992) answer it: **yes**.

- Run 1: the forked subagent ran `node "/home/runner/work/SequentDraw/SequentDraw/bin/sequentdraw"
  scan fixture/compose-app --out "$TMPDIR/bundle.json"`, which printed `wrote
  /tmp/claude-eval-.../tmp/bundle.json`, and later `printf '\x7b"title": "x", ...' | node
  ".../bin/sequentdraw" validate -`, which printed `ok`. Of the 92 tool calls that returned,
  51 were allowed (the Skill call itself is the 93rd). The 41 refused were forms outside
  the grant: `ls` of the repository root or `$TMPDIR`, `echo "CLAUDE_PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT"`,
  chains starting with `ls ... &&`, JSON heredocs such as
  `node ".../bin/sequentdraw" check - --evidence "$TMPDIR/bundle.json" <<'EOF'`,
  redirects such as `printf 'hello\n' > "$TMPDIR/probe.txt"`, and Glob or Grep with a
  `path` outside the working directory. It spent the rest of its 600 seconds probing
  the schema with trial documents and timed out without rendering.
- Run 0: the forked subagent's only two Bash calls were
  `cd /home/runner/work/SequentDraw/SequentDraw && ls && ... cat bin/sequentdraw` and
  `ls /home/runner/work/SequentDraw/SequentDraw`. Both were refused ("Permission to use
  Bash has been denied because Claude Code is running in don't ask mode"). It concluded
  that "the Bash tool is fully denied in this session" and returned without trying
  `node`. The parent then tried `cd ... && ls -la`, was refused the same way, and gave
  up.

So the failures came from the command forms and from reading one refusal as "no shell",
not from the fork. Moving the skill inline would not have changed either run: the parent
in run 0 made the same mistake. The fix is in the skill text instead. `git-map` and
`doc-map` now use the same `references/cli-pipeline.md` as the three suggestion
skills (kept byte-identical by `tests/skill-cli-pipeline.test.js`): a literal
absolute `node <plugin root>/bin/sequentdraw`, a `printf` pipe for the first save
(`check - --evidence <bundle> --emit-open <map.json>`, which writes nothing unless every
scan claim is backed), `--merge` patches for corrections, files passed by path, no
heredocs, no variables in the program path, no `cd`, no wrapper script. The reference
also says that a refused command is not a denied shell, and that the document shape is
read from `<plugin root>/schema/sequentdraw.schema.json` (`schema/` ships in the npm
package and the plugin; `docs/` does not ship in the npm package, so skills never point
at `docs/SPEC.md`), never learned by probing the CLI.

`doc-map` needed one CLI addition: `render --merge <patch|->`. Its confirmed
descriptions used to reach the figure through a heredoc of the whole map. The only
narrow-grant alternative, `check --merge - --emit-open`, also draws an open node for every
completeness gap on a business map (four on the Medusa example), which would put
structure into a figure that must never invent any. `render --merge` applies the patch
to the rendered output only and leaves the map file unchanged.

### Routing context

A `using-sequentdraw` note, injected by a `SessionStart` hook, holds the skill table in
under ~1,500 characters. It must stay small: a similar router in another plugin
injects over 20KB into every session.

No `UserPromptSubmit` nudge at first. It is added only if skill evals show a skill
under-triggering after its description has been tuned.

### Skill anatomy

```
skills/git-map/
├── SKILL.md              # portable: name + description + body (Agent Skills spec)
├── agents/openai.yaml    # Codex-only extras, if any
├── references/           # loaded on demand, keeps SKILL.md lean
└── scripts/              # thin wrappers that call `npx sequentdraw ...`
```

The `SKILL.md` body stays within the portable subset: plain Markdown instructions that
shell out to the CLI. Claude-only frontmatter (`allowed-tools`, `context`, `model`) is
used sparingly, and nothing depends on under-specified spec fields (`metadata`,
`allowed-skills`).

Example description for `grill-build`:

> Harshly critique an existing SequentDraw architecture or business map and propose
> stronger alternative tools. Use only when the user explicitly asks to grill,
> stress-test, tear apart or brutally review their build, stack or map. For a balanced
> review use eval-build instead. Not for grilling a plan with no build or map, and not
> for building n8n workflows.

## Packaging: one source, many agents

The repository is the npm package, the Claude Code plugin and its own marketplace.

```
SequentDraw/
├── .claude-plugin/
│   ├── plugin.json            # name "sequentdraw", skills become /sequentdraw:<skill>,
│   │                          # and an inline "mcpServers" bundles the MCP server
│   └── marketplace.json       # /plugin marketplace add thestealthyworker/SequentDraw
├── hooks/hooks.json           # SessionStart → using-sequentdraw routing context
├── skills/<skill>/            # the single source of truth for every agent
├── evals/<skill>/<case>/      # prompt.md + graders/*.md
├── AGENTS.md                  # always-on context for Codex, Cursor and others
├── src/                       # engine: pure core + CLI and MCP adapters
└── bin/sequentdraw
```

| Agent | How it gets the skills | Capability surface |
|---|---|---|
| Claude Code | Plugin install from the marketplace | Skills + bundled MCP server |
| Codex | Skills copied or linked into `.agents/skills` or `~/.agents/skills`; MCP in `config.toml` | Same `SKILL.md`, same MCP server |
| Cursor, Gemini CLI, Copilot | MCP config; Copilot also reads `.github/skills` | MCP server; skills where the host supports the spec |
| Anything else | The CLI (`sequentdraw render …`); an HTTP API is deferred until a real caller needs one | CLI |

Built (step 8, `sequentdraw skills install|uninstall|list`). Claude Code users get
the six skills from the plugin install; this command is for every other host, so
nobody maintains a per-agent copy of `skills/` by hand.

```
sequentdraw skills install --agent <codex|copilot|cursor> [--project <dir>] [--dry-run]
sequentdraw skills uninstall --agent <codex|copilot|cursor> [--project <dir>] [--dry-run]
sequentdraw skills list
```

| Agent | Default (user-level) | With `--project <dir>` |
|---|---|---|
| `codex` | `~/.agents/skills/<skill>` | `<dir>/.agents/skills/<skill>` |
| `copilot` | none -- refuses, and says to pass `--project` | `<dir>/.github/skills/<skill>` |
| `cursor` | `~/.cursor/skills/<skill>` | `<dir>/.cursor/skills/<skill>` |

Cursor's target was checked against Cursor's own documentation
([Agent Skills](https://cursor.com/docs/skills),
[Skills](https://cursor.com/help/customization/skills), checked 2026-09-25): Cursor
reads Agent Skills from `.cursor/skills/` and `.agents/skills/` at the project level,
and from `~/.cursor/skills/` and `~/.agents/skills/` at the user level. This command
writes to the Cursor-specific `.cursor/skills/` path rather than the `.agents/skills/`
path it shares with Codex, so uninstalling for one agent never touches what the other
reads from the same project or home directory.

Because Cursor reads BOTH `.agents/skills/` and `.cursor/skills/` at a given level,
installing for `codex` and for `cursor` at that same level (the same home directory,
or the same `--project <dir>`) leaves every one of this package's skills reachable
from two directories Cursor watches, so Cursor loads each one twice. `skills install`
checks for this: installing for either `codex` or `cursor` prints a one-line warning
on stderr, naming the other agent's directory and the `skills uninstall` command that
removes one copy, whenever that other directory already has this package's skills
installed at the same level. `copilot`'s `.github/skills/` is not a directory Cursor
reads, so it never triggers this warning.

### The trap a naive copy falls into, and the fix

Every skill resolves the engine as `node <plugin root>/bin/sequentdraw`, with the
plugin root computed as two directories above the skill's own directory
(`skills/*/references/cli-pipeline.md`, "Resolving `<sequentdraw>`") -- true only
inside a Claude Code plugin checkout. A skill copied verbatim to, say,
`~/.agents/skills/git-map/` would compute `~/.agents/bin/sequentdraw`, which does not
exist, and the file's own `npx` fallback never fires because a base directory IS
known. `git-map/SKILL.md` and `doc-map/SKILL.md` also restate the same rule inline --
and a model reads `SKILL.md` before any `references/` file, so it would follow that
copy of the rule first regardless of what `cli-pipeline.md` says. A naive copy would
therefore install six skills that cannot run the engine.

**The fix:** `skills install` rewrites exactly one section of the copied
`references/cli-pipeline.md` -- "Resolving `<sequentdraw>`", from its heading up to
the next `## ` heading -- with a generated section that names the engine command
literally, plus the one `<plugin root>/schema/sequentdraw.schema.json` reference
inside "Learning the document shape". Every copied `SKILL.md` also gets an
"Installed copy" block inserted immediately after its frontmatter (which stays
byte-identical and first in the file, since hosts parse it there) -- naming the same
literal command, defining what `<plugin root>` means for this copy, and saying
explicitly to ignore any instruction further down the same file that computes the
plugin root from the skill's own base directory. This runs for all six skills, not
only the two that currently restate the rule, so the fix does not depend on which
skill happens to carry a copy of it today:

- Running from a stable path (a git checkout, or a global or local `npm install`):
  the command is `node "<absolute path of this package>/bin/sequentdraw"`, and the
  schema reference becomes that same package's literal
  `<path>/schema/sequentdraw.schema.json`.
- Running from a temporary `npx` cache (its own path contains a `_npx` directory
  segment, which will be cleaned up later): the command is
  `npx -y sequentdraw@<exact package.json version>`, the schema reference becomes a
  sentence saying the schema ships inside the package and the CLI validates every
  document against it, and the printed output recommends `npm install -g sequentdraw`
  for a faster, stable engine.

Every other file is copied byte for byte, as is the rest of `cli-pipeline.md` and of
`SKILL.md` around their one rewritten section and inserted block respectively; the
repository's own `skills/` is never modified by this command.

### Safety rules

1. Each installed skill directory gets a marker file `.sequentdraw-install.json`
   (`{ "package": "sequentdraw", "version": ..., "skill": ..., "engine": <the
   command written> }`).
2. Install replaces a target directory only if it is absent or carries this
   package's own marker. A directory without the marker is never touched: that one
   skill is refused by name, the rest still install, and the run exits non-zero.
3. Uninstall removes only directories that carry the marker, and only the six skill
   names this package ships -- a foreign directory sharing the same root survives.
4. A target path, or any existing directory below the install root, that is a
   symlink is refused rather than written through. This repository's own
   `.agents/skills/<name>` entries ARE symlinks into `skills/<name>`
   (`scripts/sync-agent-skills.js`), so `skills install --agent codex --project
   <this repo>` refuses every one of them by name instead of writing through them
   into the real `skills/`.
5. `--dry-run` prints every action and changes nothing.
6. Only `skills/<name>/` for a name that has a `SKILL.md` is ever copied -- never
   `.claude/`, `CLAUDE.md`, `docs/`, `evals/` or anything else.
7. The home directory always comes from `os.homedir()`, never from a
   user-controlled argument other than `--project`, which must already exist.

After an install, the command prints the MCP server configuration snippet for that
agent (the same two shapes documented below, "The MCP server" -- `src/skills-install/mcp-snippet.js`
is their one source in code, so this printout and that section never drift apart).

`skills list` prints the six skills this package ships with the first sentence of
each one's `description`.

### The MCP server

Built (step 8, `sequentdraw mcp`). A hand-rolled stdio JSON-RPC 2.0 transport --
newline-delimited JSON, one message per line -- over `initialize`,
`notifications/initialized`, `ping`, `tools/list` and `tools/call`. No dependency
was added for it (step 8a just spent real effort getting `npm audit` clean); the
transport is `src/mcp/server.js`, the tools are `src/mcp/tools.js`.

**One MCP tool per CLI command**, each a thin adapter calling the exact same
`COMMANDS[name].run(args, io)` from `src/cli/index.js` the CLI dispatches to, with
`io.stdout`/`io.stderr`/`io.stdin` captured in memory. This is what makes an MCP
call give the same answer and the same refusal a CLI invocation would for the same
input (`docs/design/gitrepo-suggest.md` line 38 depends on it). `mcp` itself is a
seventh CLI command, but never a seventh tool -- `tools.js` lists the six by name,
not from `COMMANDS`' own keys.

| Tool | Mirrors |
|---|---|
| `sequentdraw_render` | `sequentdraw render` |
| `sequentdraw_validate` | `sequentdraw validate` |
| `sequentdraw_scan` | `sequentdraw scan` |
| `sequentdraw_check` | `sequentdraw check` |
| `sequentdraw_catalogue` | `sequentdraw catalogue` |
| `sequentdraw_licences` | `sequentdraw licences` |

Each tool takes typed arguments (a JSON Schema, `additionalProperties: false`), not
an argv string. A document is given inline (`document`, an object) or `path` (a file),
never both; a merge patch works the same way (`merge` / `merge_path`). Inline input
goes to the CLI over stdin as `-`; when both the document and the patch are inline
(so stdin is already spoken for), the patch is written to a private temp file instead
and removed once the call returns. Output paths (`out`, `evidence`, `repos`,
`emit_open`) are always real files, exactly as the CLI takes them. Every path
argument may be relative -- it resolves against this server's own working
directory -- but an absolute path is recommended, since a host is free to launch
the server from anywhere.

`sequentdraw_licences` never takes a `token_env`: the CLI flag exists for a
human choosing where their own token lives, but exposing it as a tool argument
would let a caller read out the value of ANY environment variable in this
process by naming it and reading GitHub's rejection back. The MCP tool always
uses the CLI's default, `GITHUB_TOKEN`, read from this server's own
environment.

A tool result is `{ content: [{ type: "text", text: <stdout, then stderr> }], isError:
exitCode !== 0 }` -- a command failing (an invalid document, an unverified repository
link) is a tool result with `isError: true`, never a JSON-RPC error. JSON-RPC errors
(`-32700` parse error, `-32600` invalid request or an oversized line, `-32601` unknown
method, `-32602` invalid params) are reserved for protocol problems: an unknown tool,
an argument that fails its schema, or a call to `tools/call` itself malformed.

Claude Code gets the server bundled through `.claude-plugin/plugin.json`'s own
inline `mcpServers` field -- deliberately not a root-level `.mcp.json`, which
Claude Code would ALSO load as a project-scoped server whenever a contributor
opens this repository itself, where `${CLAUDE_PLUGIN_ROOT}` does not expand (it
is only defined for a server the plugin bundles):

```json
{
  "mcpServers": {
    "sequentdraw": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw", "mcp"]
    }
  }
}
```

Any other MCP-speaking host (Cursor, Gemini CLI, Copilot) points the same
`mcpServers` shape at wherever the package is installed, without `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "sequentdraw": {
      "command": "node",
      "args": ["/absolute/path/to/sequentdraw/bin/sequentdraw", "mcp"]
    }
  }
}
```

Codex reaches it through `config.toml`:

```toml
[mcp_servers.sequentdraw]
command = "node"
args = ["/absolute/path/to/sequentdraw/bin/sequentdraw", "mcp"]
```

## Proving skills work

Three kinds of check per skill, run by `claude plugin eval`:

| Kind | Example | Grader |
|---|---|---|
| Should trigger | "Map how our cleaning business takes and fulfils a booking" → `business-map` | `tool_used: Skill`, input matching the skill |
| Should not trigger | "Review my architecture" must not fire `grill-build`; "build me an n8n workflow" must not fire any SequentDraw skill | `tool_used: Skill` must not match |
| Correct output | The produced JSON validates, gap-checks and renders; each suggestion passes suggestion validation; every `gitrepo-suggest` candidate is MIT | `file_exists` for the HTML, `regex` on the trace for the engine's success lines; `llm` rubric only for judgement calls such as "the critique is harsher than eval-build's" |

Rules:

- **Each case runs with and without the plugin** (the default `--ablation with-without`).
  A case only counts if the plugin changes the outcome.
- **Deterministic graders come first.** The engine's own validator decides whether
  output is correct. LLM judges are for what cannot be computed.
- **Pass threshold 0.8** over the default 3 runs per case.
- **The `eval-build` / `grill-build` pair gets dedicated confusion cases** in both
  directions, since theirs are the two closest descriptions.
- **Every skill PR includes its skill evals.** A skill without passing evals does not
  merge.

### CI

| Job | Runs on | Cost |
|---|---|---|
| `claude plugin validate . --strict`, plus a check that each description is ≤ 1,536 chars and states what it is not for | Every PR | Free |
| `npm test` (engine) | Every PR | Free |
| `npm run preflight` | Locally, before every push | Free |
| `claude plugin eval . --trust-plugin --no-publish --json --threshold 0.8 --max-cost-usd 10` | PRs touching `skills/`, `evals/`, `hooks/`, `.claude-plugin/`, or carrying the `run-evals` label | Counts against the owner's Claude subscription usage |

**Credential: the owner's Claude subscription.** The owner runs `claude setup-token`
(it requires a subscription and a browser login) and stores the long-lived token as the
repository secret `CLAUDE_CODE_OAUTH_TOKEN`. The eval job exposes it to `claude` as that
environment variable. It is never printed,
committed or pasted into a conversation. The job uses `pull_request`, never
`pull_request_target`, so pull requests from forks never receive the secret.

With a subscription there is no per-call bill. `--max-cost-usd` (50 since PR #50,
owner-approved) is a usage guard, metered at API-equivalent prices, that stops a runaway
suite before it eats the subscription's usage limits. It does not protect the plan's
session limit: PR #50's first full run hit that limit mid-suite, and every later run
failed with "You've hit your session limit". Runs use `--concurrency 4` since PR #50
(they share one rate limit, so this shortens wall time, not usage).

**A PR runs only the cases for the skills it touches** (PR #50).
`scripts/select-eval-tags.js` maps changed paths to skills, and the workflow passes
`--tag <skill...>`. Every case's `prompt.md` is tagged with each skill it exercises,
and a test enforces it. `--case` takes a single glob (`claude plugin eval --help`:
`--case <glob>`), while `--tag <tag...>` takes several. A change to `hooks/` or
`.claude-plugin/` runs the full suite, since either changes how every skill triggers.

**The engine does not run evals by default.** A change only to `src/`, `bin/`,
`schema/`, `package*.json`, the selection or guard script, or the workflow itself runs
nothing: the design here only ever asked for evals on PRs touching `skills/`,
`evals/`, `hooks/` or the CLI contract, but the implementation ran ahead of it and sent
every engine PR (#78-#86) to the full ~65-run suite regardless — #86's run died on
"You've hit your session limit." **Add the `run-evals` label** to an engine PR that
changes what the CLI prints or accepts (the CLI contract the skills depend on) to opt
that PR into the full suite; adding the label to an already-open PR starts a run
without a new commit. A manual `workflow_dispatch` run does the same with no PR at
all. The opt-in always wins over path selection, whatever else did or didn't change.
The full suite also runs once more at the final review, regardless of what the
milestone PR touched. `scripts/eval-results-guard.js` fails the job on a results file
with zero cases and on any run error, except a run that stopped at its own limit; in a
must-not-fire case only a turn limit with turns >= N is tolerated.

**Narrow the suite while iterating.** A full run is 28 agent runs: roughly 25 minutes
and a real slice of the subscription's usage. While fixing one skill, run only the
cases that skill owns — `--case 'git-map-*'` is three cases and about six minutes — and
keep the full suite for the run that gates the merge. The risk this accepts is a
regression in an unrun case reaching that final run; the cost it avoids is re-running
seven unaffected cases on every attempt. Agreed with the owner on 2026-09-16, after a
day of twelve runs in which two succeeded.

**Run `npm run preflight` before pushing anything that triggers evals.** It takes about
a second and statically catches the three mistakes that each cost a full round that
day: a duplicate YAML key in a workflow, a grader grading produced output in a case
that grants no `Bash`, and a prompt naming a path no scaffold puts in the empty
workspace. Five of the seven avoidable failures that day were of those three kinds.

Cross-agent behaviour cannot be tested automatically yet: no common eval harness runs
the same skill against Claude Code, Codex and Cursor. Codex triggering is checked by
hand before each release, using the same eval prompts as a script.

## Build order

**`docs/HANDOVER.md` owns the build order**, as `CLAUDE.md` states. It is deliberately
not repeated here — it used to be, and the two copies drifted: they disagreed about the
step numbers (Mode B was 5 here and 6 there) and this copy carried `gitrepo-suggest` as
a step the authoritative list did not mention at all. One list, one place.

What this document owns is which skill ships with which step. Skills ship in the same PR
as the engine feature they drive:

| HANDOVER step | Skill shipped |
|---|---|
| 5 — extraction, Mode A | `git-map` and `doc-map`, plus the plugin scaffold (`plugin.json`, `marketplace.json`, hooks, `using-sequentdraw`) and the eval CI job |
| 6 — Mode B as a question flow, with gap rendering | `business-map`, without its suggestion step |
| 7 — suggestion agent | the `business-map` suggestion step, `eval-build` and `grill-build` (shipped) |
| 7a — correction mode (after M2, `docs/design/correction-mode.md`) | none. Every skill from `git-map` on already accepts conversational corrections and re-validates before rendering |
| 7b — GitHub search with licence verification | `gitrepo-suggest` |
| 8 — tours, then the MCP server, then `skills install` (HTTP API deferred) | none |
