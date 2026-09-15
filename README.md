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
```

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
