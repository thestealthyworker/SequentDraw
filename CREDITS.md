# Credits

SequentDraw builds on the following open-source projects and published material.
Licences were checked against each repository on 2026-09-15.

## Runtime dependencies

| Project | Used for | Licence |
|---|---|---|
| [elkjs](https://github.com/kieler/elkjs) — JavaScript build of the [Eclipse Layout Kernel](https://github.com/eclipse/elk) | Every node, container and edge coordinate. The layered algorithm with orthogonal edge routing does all layout. | EPL-2.0 OR GPL-3.0-or-later |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Brand icon paths and colours, looked up by slug in `src/icons.js`. | CC0-1.0 |

Brand icons are trademarks of their respective owners. Showing one in a map
identifies the tool; it does not imply endorsement. The example map shows Next.js,
React, Stripe, Redis, PostgreSQL, GitHub Actions and Jest.

## Design prior art

**[cc-wf-studio](https://github.com/breaking-brake/cc-wf-studio)** by breaking-brake.
We reviewed it during design and did not copy any code or schema. These design
decisions were adopted from it, as recorded in [`docs/SPEC.md`](docs/SPEC.md#prior-art-cc-wf-studio):

- grouping by `parentId` on the node, one level deep
- `condition` carried on the connection rather than on a branch node
- explicit validation rules with hard numeric caps (the 100-node limit)
- tours: ordered steps that spotlight nodes with narration
- one workflow file as the single source of truth across every interface

Licensing there is mixed: `packages/core`, `packages/cli` and `packages/mcp` are MIT;
the repository root and the VS Code extension are AGPL-3.0.

**[n8n](https://github.com/n8n-io/n8n)** by n8n GmbH. The map's visual style
(node shape, handles, edge curves, canvas grid, frames) and layout strategy follow
n8n's workflow canvas. They are re-implemented from a written description; no n8n
source, styles or assets are included. See
[`docs/design/n8n-visual-style.md`](docs/design/n8n-visual-style.md). n8n is
licensed under the Sustainable Use License, with Enterprise-licensed `.ee` files.

## Example material

**[Medusa](https://github.com/medusajs/medusa).** `examples/medusa-return-flow.json`
was written by hand from Medusa's published documentation on order returns (RMA).
It describes the flow; it contains no Medusa source code. Medusa is MIT-licensed,
except for Enterprise Edition materials.
