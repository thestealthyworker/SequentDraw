# Design proposal: skills, plugin and evals

Status: **proposed** · 2026-09-15

SequentDraw is meant to be driven by AI tools: Claude Code, Codex and other agents
call it through skills, an MCP server, a CLI or an HTTP API. This document settles
which skills exist, how they get triggered, how one skill set serves several agents,
and how we prove each skill works.

Facts below were checked on 2026-09-15 against the Claude Code docs
([skills](https://code.claude.com/docs/en/skills.md),
[hooks](https://code.claude.com/docs/en/hooks-guide.md),
[plugin evals](https://code.claude.com/docs/en/plugin-evals.md)), against
`claude plugin eval --help` on Claude Code 2.1.272, and against the Codex skills docs
and the open [Agent Skills](https://github.com/agentskills/agentskills) specification.

## How triggering actually works

- **The model picks a skill from its description.** Claude, and Codex, see every
  skill's `name` and `description`. The body loads only when a skill is chosen.
  In Claude Code, `description` plus `when_to_use` is capped at 1,536 characters;
  anything beyond is truncated.
- **Hooks cannot invoke a skill.** A hook can inject text as additional context, or
  allow or block a tool call; nothing more. So a hook can remind Claude that a
  skill applies, but it cannot run one. Reliable routing comes from sharp
  descriptions, measured by evals, and hooks only add a nudge.
- **The engine is the source of truth.** Skills do not reason about layout or
  schema. They produce or edit workflow JSON, then call the engine to validate and
  render it. Invalid output fails loudly in the engine, not quietly in prose.

## Skills

One skill per outcome, with boundaries narrow enough that two descriptions never
compete for the same request.

| Skill | Triggers on | Does | Ships with |
|---|---|---|---|
| `render-map` | "draw / map / visualise this workflow", a workflow JSON file, "update the map" | Validates the JSON, renders the n8n-style HTML, reports the output path | n8n renderer CLI |
| `sticky-notes` | "explain this step on the map", "add a note / description to the workflow" | Adds or edits `notes` entries attached to the right nodes, re-renders | Text notes |
| `map-from-repo` | "map this codebase", "diagram our architecture / services / integrations" | Reads the repo, writes the technical-layer JSON, marks unknowns `open`, renders | Extraction Mode A |
| `business-interview` | "map how my business works", "document our process end to end" | About 8 questions tracing one unit of value; writes business and edge layers with `open` gaps; renders | Mode B + gap detection |
| `recommend-tools` | "what tools should we use", "what is missing from this workflow" | 3–5 n8n integrations as `suggested` nodes, each rationale citing nodes in the map | Suggestion agent |
| `tour` | "walk me through this map" | Writes ordered tour steps | Tours |

Deliberate boundaries:

- **Building a runnable n8n workflow is not ours.** "Build me an n8n workflow" belongs
  to n8n's own skills. SequentDraw documents and designs flows; it does not deploy
  them. Every description says so, and evals assert it stays quiet.
- **Generic diagram requests are not ours** ("make a Mermaid sequence diagram", "draw
  a pie chart").
- **Gap detection is an engine command** (`sequentdraw check`), called by
  `map-from-repo` and `business-interview`. It is not a separate skill, so there is
  no third description competing for "what's missing".
- **`business-interview` runs inline, never as a forked subagent.** It is a
  conversation with the user, and a forked subagent cannot hold one.
  `map-from-repo` may run as `context: fork`, because it reads code without
  needing the user.

### Routing context

A `using-sequentdraw` note, injected by a `SessionStart` hook, holds the table above
in under ~1,500 characters. It must stay small: a similar router in another plugin
injects over 20KB into every session.

No `UserPromptSubmit` nudge at first. It fires on every prompt, and it would only
cover for weak descriptions. It is added only if evals show a skill under-triggering
after its description has been tuned.

### Skill anatomy

```
skills/render-map/
├── SKILL.md              # portable: name + description + body (Agent Skills spec)
├── agents/openai.yaml    # Codex-only extras, if any
├── references/           # loaded on demand, keeps SKILL.md lean
└── scripts/              # thin wrappers that call `npx sequentdraw ...`
```

The `SKILL.md` body stays within the portable subset: plain Markdown instructions that
shell out to the CLI. Claude-only frontmatter (`allowed-tools`, `context`, `model`) is
used sparingly, and nothing depends on under-specified spec fields (`metadata`,
`allowed-skills`).

Example description for `render-map`:

> Render or update a SequentDraw workflow map: an interactive n8n-style HTML diagram
> of a business process or system architecture, built from a SequentDraw workflow JSON
> file. Use when the user asks to draw, map, visualise or re-render a workflow, process
> or architecture map, or points at a `*.sequentdraw.json` file. Not for building or
> running n8n workflows, and not for Mermaid or general charts.

## Packaging: one source, many agents

The repository is the npm package, the Claude Code plugin and its own marketplace.

```
SequentDraw/
├── .claude-plugin/
│   ├── plugin.json            # name "sequentdraw"; skills become /sequentdraw:<skill>
│   └── marketplace.json       # /plugin marketplace add thestealthyworker/SequentDraw
├── .mcp.json                  # SequentDraw MCP server over stdio (render, validate, check)
├── hooks/hooks.json           # SessionStart → using-sequentdraw routing context
├── skills/<skill>/            # the single source of truth for every agent
├── evals/<skill>/<case>/      # prompt.md + graders/*.md
├── AGENTS.md                  # always-on context for Codex, Cursor and others
├── src/                       # engine: pure core + CLI, HTTP and MCP adapters
└── bin/sequentdraw
```

| Agent | How it gets the skills | Capability surface |
|---|---|---|
| Claude Code | Plugin install from the marketplace | Skills + bundled MCP server |
| Codex | Skills copied or linked into `.agents/skills` or `~/.agents/skills`; MCP in `config.toml` | Same `SKILL.md`, same MCP server |
| Cursor, Gemini CLI, Copilot | MCP config; Copilot also reads `.github/skills` | MCP server; skills where the host supports the spec |
| Anything else | `curl` against the HTTP API | HTTP API |

A later `npx sequentdraw skills install --agent codex|cursor|copilot` copies `skills/`
into each host's location, so nobody maintains per-agent copies.

## Proving skills work

Three kinds of check per skill, run by `claude plugin eval`:

| Kind | Example | Grader |
|---|---|---|
| Should trigger | "Can you diagram our returns process from this JSON?" | `tool_used: Skill`, input matching `render-map` |
| Should not trigger | "Build me an n8n workflow that emails new leads" | `tool_used: Skill` must not match any SequentDraw skill |
| Correct output | The produced JSON validates and renders | `file_exists` for the HTML, plus a `regex` on the trace for the engine's success line; `llm` rubric only for judgement calls such as "rationale cites nodes that exist" |

Rules:

- **Each case runs with and without the plugin** (the default `--ablation with-without`).
  A case only counts if the plugin changes the outcome; a good answer the base model
  would give anyway proves nothing about the skill.
- **Deterministic graders come first.** The engine's own validator decides whether
  output is correct. LLM judges are for what cannot be computed.
- **Pass threshold 0.8** over the default 3 runs per case.
- **Every skill PR includes its evals.** A skill without passing evals does not merge.

### CI

| Job | Runs on | Cost |
|---|---|---|
| `claude plugin validate . --strict`, plus a check that each description is ≤ 1,536 chars and states what it is not for | Every PR | Free |
| `npm test` (engine) | Every PR | Free |
| `claude plugin eval . --trust-plugin --no-publish --json --threshold 0.8 --max-cost-usd <cap>` | PRs touching `skills/`, `evals/`, `hooks/` or the CLI contract | Billed model calls |

The eval job needs a Claude credential stored as a repository secret, and a per-run
cost cap. The owner sets both before the first skill PR (see open questions).

Cross-agent behaviour cannot be tested automatically yet: no common eval harness runs
the same skill against Claude Code, Codex and Cursor. Codex triggering is checked by
hand before each release, using the same eval prompts as a script.

## Build order

Skills ship in the same PR as the engine feature they drive:

1. **n8n renderer + CLI** → plugin scaffold (`plugin.json`, `marketplace.json`, hooks,
   `using-sequentdraw`, eval CI) and `render-map` with its evals.
2. **Text notes** → `sticky-notes`.
3. Schema validation and layout tests. No new skill; they harden every output grader.
4. **Extraction Mode A** → `map-from-repo`.
5. **Mode B + gap detection** → `business-interview`.
6. **Suggestion agent** → `recommend-tools`.
7. **Tours** → `tour`.
8. MCP server and HTTP API once two or more skills exist, then `skills install` for
   other agents.

## Open questions for the owner

1. **Eval budget.** Which credential to use in CI (an API key or a Claude subscription
   token), and the maximum spend per eval run.
2. **Skill names.** As listed above, or something closer to how users phrase requests.
