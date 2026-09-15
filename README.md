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

This installs the `git-map` and `doc-map` skills (`/sequentdraw:git-map`,
`/sequentdraw:doc-map`) and a `SessionStart` hook that gives Claude a short
routing note on which skill applies. `git-map` turns a repository (a local
path or a GitHub URL) into an interactive architecture map, built only from
a deterministic scan — see [`docs/design/git-map.md`](docs/design/git-map.md).
`doc-map` exports an existing SequentDraw map as a static SVG figure for
docs and slides — see [`docs/design/n8n-visual-style.md`](docs/design/n8n-visual-style.md)'s
"Documentation export". Every skill that produces a map or figure publishes
it as a private Claude artifact and keeps a local copy outside the repo,
writing into the repo only when asked.

The same `skills/` directory is Codex-usable too: `.agents/skills/doc-map`
and `.agents/skills/git-map` mirror `skills/doc-map` and `skills/git-map`
(as a symlink, or a synced copy via `npm run sync-agent-skills` on a
platform where symlinks are unavailable).

## CLI

```sh
npx sequentdraw render <in.json> <out.html|out.svg> [--layers a,b] [--fragment]
npx sequentdraw validate <in.json>
npx sequentdraw scan <path|github-url> --out <bundle.json> [--timeout <ms>]
npx sequentdraw check <map.json> --evidence <bundle.json>
```

- `render` writes an interactive HTML map (`.html`) or a static SVG
  documentation figure (`.svg`). `--layers a,b` (SVG only) adds layers
  beyond the always-included `base`. `--fragment` (HTML only) emits the
  artifact fragment shown above instead of a full document.
- `validate` prints `ok` and exits 0 for a valid workflow JSON document, or
  one `path  message` line per error to stderr and exits 1.
- `scan` turns a local path or a `https://github.com/<owner>/<repo>` URL
  into an evidence bundle (JSON): services, data stores, integrations and
  the dependency edges between them, each claim citing a deterministic
  finding. Nothing in the scanned repository is ever executed. Fails loudly
  (one clear line, nothing written) on an invalid source, an invalid ref, or
  a scan that exceeds its deadline (`--timeout`, default 60s).
- `check` runs `validateDoc()` then `checkEvidence()`: every `"source":
  "scan"` node or edge in `<map.json>` must cite an id that exists in the
  bundle and actually supports the claim. Prints `ok` and exits 0, or one
  `path  message` line per error and exits 1.
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
