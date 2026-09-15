# Credits

SequentDraw builds on the following open-source projects and published material.
Licences were checked against each repository on 2026-09-15.

## Runtime dependencies

| Project | Used for | Licence |
|---|---|---|
| [elkjs](https://github.com/kieler/elkjs) — JavaScript build of the [Eclipse Layout Kernel](https://github.com/eclipse/elk) | Every node, container and edge coordinate. The layered algorithm with orthogonal edge routing does all layout. | EPL-2.0 OR GPL-3.0-or-later |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Brand icon paths and colours, looked up by slug in `src/icons.js` and `src/scan/crosswalk.js`. | CC0-1.0 |
| [@specfy/stack-analyser](https://github.com/specfy/stack-analyser), pinned to exactly `1.27.6` | The `git-map` scan engine's technology and dependency detector (`src/scan/scan.js`), run only against SequentDraw's own safe, limited, read-only provider (`src/scan/safe-provider.js`) — never given direct filesystem access. Licence verified against the GitHub repository on 2026-09-16 via `gh api repos/specfy/stack-analyser/license`. | MIT |
| [yaml](https://github.com/eemeli/yaml), pinned to exactly `2.9.1` | Bounded YAML parsing for docker-compose and GitHub Actions workflow files (`src/scan/yaml-safe.js`), with `maxAliasCount` and an input-size cap so a crafted "alias bomb" document cannot exhaust memory or hang the scan. Pinned above the version `@specfy/stack-analyser` itself depends on (`2.8.0`) because that older version has a published stack-overflow advisory on deeply nested (non-aliased) YAML; SequentDraw's own direct use gets the patched release even though stack-analyser's nested copy does not. | ISC |

Brand icons are trademarks of their respective owners. Showing one in a map
identifies the tool; it does not imply endorsement. The example map shows Next.js,
React, Stripe, Redis, PostgreSQL, GitHub Actions and Jest.

## Development dependencies

| Project | Used for | Licence |
|---|---|---|
| [ajv](https://github.com/ajv-validator/ajv) | Validates `schema/sequentdraw.schema.json` against fixtures in `tests/schema-parity.test.js`, proving the published JSON Schema agrees with `validateDoc()`. Dev-only: not a runtime dependency, not shipped in any rendered output. | MIT |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | Parses every SVG the documentation-export tests produce (`tests/n8n-doc-export.test.js`) to assert it is well-formed XML. Dev-only: not a runtime dependency, not shipped in any rendered output. Licence checked via `gh api repos/xmldom/xmldom/license` on 2026-09-15. | MIT |

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

**Scan-engine fixture repos** (`tests/fixtures/repos/compose-app`,
`tests/fixtures/repos/next-supabase-stripe`, `tests/fixtures/repos/fastapi-celery`).
Small, hand-written synthetic repositories used to test `src/scan/`'s evidence
extraction end to end. Written by the SequentDraw project for this purpose; MIT,
not derived from any other repository. The "hostile" fixture used by
`tests/scan-hostile.test.js` (symlinks, an oversized/binary file, a real `.env`
with a fake secret, a YAML alias bomb, prompt-injection text, and 25,000 empty
files) is generated at test time by `tests/fixtures/build-hostile-repo.js` rather
than committed.

**[dockersamples/example-voting-app](https://github.com/dockersamples/example-voting-app)**
(Apache-2.0). Cloned at a pinned commit only by the gated integration test
`tests/scan-network.test.js` (`SEQUENTDRAW_NETWORK_TESTS=1`), never vendored into
this repository.
