# SequentDraw

Generates architecture and business-process maps as self-contained interactive HTML.

One JSON file describes the system semantically. Layout is computed by ELK, never
authored. Layers can be toggled so the same map serves a developer and a client.

Not a diagram editor. The JSON is the product; the HTML is a view of it.

```
input  →  workflow.json  →  ELK layout  →  HTML render
         (semantic only)   (deterministic)  (deterministic)
```

## Distribution target

SequentDraw is built to be called by AI tools, not only run by hand. Every
capability should be reachable through:

- a **Claude Code plugin** (skills and commands)
- **Codex and other agents**, via MCP and an `AGENTS.md`-style entry point
- a **CLI** (`npx sequentdraw ...`)
- an **HTTP API** that works with plain `curl`: post a workflow JSON, get HTML back

The render core stays a pure library. Each interface is a thin adapter over it.

## Quick start

```sh
npm install
node src/n8n/cli.js examples/medusa-return-flow.json out/medusa.html
npm test
```

Open `out/medusa.html` in a browser: drag to pan, scroll to zoom, and toggle layers
from the bar at the top.

In code:

```js
const { renderMap } = require('./src/n8n');
const html = await renderMap(workflowJson); // validated, laid out, one self-contained HTML string
const fragment = await renderMap(workflowJson, { fragment: true }); // no <!DOCTYPE>/<html>/<head>/<body> — for embedding in a host page
```

## Install as a Claude Code plugin

```
/plugin marketplace add thestealthyworker/SequentDraw
/plugin install sequentdraw@sequentdraw
```

This installs five skills and a `SessionStart` hook that gives Claude a short
routing note on which skill applies:

| Skill | What it does |
|---|---|
| `/sequentdraw:git-map` | Maps a repository (a local path or a GitHub URL) into an interactive architecture map, built only from a deterministic scan. Anything the scan cannot establish becomes an open question. See [`docs/design/git-map.md`](docs/design/git-map.md). |
| `/sequentdraw:business-map` | Maps a business, process or idea by interviewing you, then offers up to five n8n integrations as suggestions you accept or decline. See [`docs/design/business-map.md`](docs/design/business-map.md). |
| `/sequentdraw:eval-build` | A balanced review of an existing map: what works, what is missing, what is fragile, drawn into the map. |
| `/sequentdraw:grill-build` | A harsh critique of an existing map, only when you ask to grill or stress-test it, with alternatives drawn beside what they replace. |
| `/sequentdraw:doc-map` | Exports an existing map as a static SVG figure for docs and slides. See [`docs/design/n8n-visual-style.md`](docs/design/n8n-visual-style.md)'s "Documentation export". |

Every skill that produces a map or figure publishes it as a private Claude artifact
and keeps a local copy outside the repo, writing into the repo only when asked.

The same `skills/` directory is Codex-usable too: `.agents/skills/<skill>` mirrors
`skills/<skill>` for all five (as a symlink, or a synced copy via
`npm run sync-agent-skills` on a platform where symlinks are unavailable).

## CLI

```sh
npx sequentdraw render <in.json|-> <out.html|out.svg> [--layers a,b] [--fragment] [--merge <patch.json|->]
npx sequentdraw validate <in.json|->
npx sequentdraw scan <path|github-url> --out <bundle.json> [--timeout <ms>]
npx sequentdraw check <map.json|-> [--merge <patch.json|->] [--evidence <bundle.json>] [--emit-open <out.json>]
npx sequentdraw catalogue [--category <name>] [--json]
```

- `-` as the input document reads it from stdin, so a map built in
  conversation can be piped straight in (`printf '%s' '<json>' | node
  .../bin/sequentdraw check - ...` keeps the command starting with `node`)
  without being written to disk first. When the input is a file, `-` may
  instead be a `--merge` patch. Output paths, `--evidence` and `--emit-open`
  are always real files. Both sources share one 16MB cap and fail loudly past it.

- `render` writes an interactive HTML map (`.html`) or a static SVG
  documentation figure (`.svg`). `--layers a,b` (SVG only) adds layers
  beyond the always-included `base`. `--fragment` (HTML only) emits the
  artifact fragment shown above instead of a full document. `--merge <patch>`
  applies a patch (below) to the rendered output only; the input file is
  never changed.
- `validate` prints `ok` and exits 0 for a valid workflow JSON document, or
  one `path  message` line per error to stderr and exits 1.
- `scan` turns a local path or a `https://github.com/<owner>/<repo>` URL
  into an evidence bundle (JSON): services, data stores, integrations and
  the dependency edges between them, each claim citing a deterministic
  finding. Nothing in the scanned repository is ever executed. Fails loudly
  (one clear line, nothing written) on an invalid source, an invalid ref, or
  a scan that exceeds its deadline (`--timeout`, default 60s).
- `check` runs `validateDoc()`, then `checkEvidence()` when `--evidence` is
  given (every `"source": "scan"` node or edge in `<map.json>` must cite an
  id that exists in the bundle and actually supports the claim), then the
  completeness rules: every artifact has a named recipient, every external
  input a named source actor, every decision a named decider, every unhappy
  path an owner, and the flow ends in someone's hands rather than inside a
  system. Completeness runs only on a map carrying a `business` layer, so a
  scanned architecture map is unaffected. Prints `ok` and exits 0, or one
  `path  message` line per problem and exits 1. `--emit-open <out.json>`
  writes a *copy* of the map with one `open` question node per gap and exits
  0; the input is never modified in place, and the copy passes `check`.
  `--merge <patch>` first applies a small patch to the map, so a change
  never means re-typing it: `{"nodes": [...], "edges": [...], "notes": [...],
  "remove": {"nodes": [ids], "edges": [{"from", "to"}], "notes": [ids]}}`.
  Removals run first; removing a node removes its edges.
- `catalogue` lists the n8n integrations a suggestion may name.
- Every subcommand takes `--help`. Unknown flags or extra arguments print
  usage and exit 1, and nothing is written to disk on error.

`node src/n8n/cli.js <in.json> <out.html|out.svg> [--layers a,b]` keeps
working unchanged as the underlying renderer entry point.

## Status

Early. The n8n-style renderer works and is covered by layout invariant and security
tests. Next come sticky notes, then mapping a repository (`git-map`). The prototype
renderer (`src/render-html.js`) is kept as a record.

- [`docs/SPEC.md`](docs/SPEC.md) — visual grammar and IR schema
- [`docs/HANDOVER.md`](docs/HANDOVER.md) — what was proven, known defects, build order
- [`examples/README.md`](examples/README.md) — fixtures and where they came from

## Credits

Layout by [elkjs](https://github.com/kieler/elkjs) (Eclipse Layout Kernel). Brand
icons from [Simple Icons](https://github.com/simple-icons/simple-icons). Some schema
design decisions adopted from [cc-wf-studio](https://github.com/breaking-brake/cc-wf-studio).
Example flow based on [Medusa](https://github.com/medusajs/medusa)'s documentation.
Full details and licences in [`CREDITS.md`](CREDITS.md).

## License

MIT. See [`LICENSE`](LICENSE).
