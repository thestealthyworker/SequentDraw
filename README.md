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
mkdir -p out
node src/render-html.js examples/medusa-return-flow.json out/medusa.html
npm test
```

## Status

Early. The prototype renderer runs and is pinned by a layout regression test.

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
