// The interactive HTML output must not change by accident. This pins
// `renderMap()` on the Medusa fixture so any drift has to be a decision
// somebody made deliberately.
//
// Rebaselined for CTO-M1-04 (sticky notes landing far from the
// nodes they annotate). That finding was raised against this very output,
// so fixing it necessarily changed it: attached notes are now placed
// beside what they name, a note whose targets are too far apart to sit
// beside carries a connector line, and layout settles note placement and
// edge routing against each other. Node positions, frames, edge routes,
// handles and the viewer script are otherwise untouched by that work.
//
// Rebaselined again for CTO-M1-04's second round (a note connector drawn
// straight through an unrelated node). That finding, too, was raised against this
// very output, so fixing it necessarily changed it: a connector is now an
// obstacle-routed <path> instead of a straight <line>, so the Medusa
// map's two `note-link` elements changed shape, and one of them bends
// around the Event bus node rather than cutting through it. Nothing else
// moved — note and node positions, frames, edge routes, handles and the
// viewer script are untouched by that work.
//
// Rebaselined for build step 7a, correction mode
// (docs/design/correction-mode.md). Two deliberate additions to every
// interactive render: the validated source document, embedded as the
// SOURCE_DOC literal so the page can write a corrected copy of itself,
// and the correction operations plus their wiring, which the browser
// cannot require() from src/n8n/correct-ops.js. Together they take the
// Medusa render from 152,693 to 212,519 bytes, +39%. Nothing that was
// already on the canvas moved: node positions, frames, edge routes,
// handles, notes and note connectors are byte-identical, and the added
// controls are a button and a panel that sit outside the SVG.
//
// The number moved once more within that step, when review found that an
// operation addressed an edge by its render-time index: the fix adds the
// edge track (correct-ops.js's trackEdges/edgesRemovedBy) to the emitted
// script.
//
// Rebaselined again for the Notes control in the layer bar, requested by
// the owner: one more label in the bar, one more branch in applyLayers.
// Nothing on the canvas moved.
//
// Rebaselined for step 7c, export from the viewer: two buttons, the export
// script, and the page's own stylesheet embedded a second time so the
// exported SVG stands alone. Nothing on the canvas moved.
//
// Rebaselined for the status key (issue #56, CTO-M2-04). The Medusa map
// has no open or suggested node, so it gains no key; what changed is the
// viewer: the key's stylesheet rules, the recount in applyLayers, and the
// export's exportKeyGroup(), which carries an on-screen key into an
// exported file. +4,132 bytes. Nothing on the canvas moved.
//
// Rebaselined for tours (build step 8). The Medusa fixture has no tour, so
// it gains no button and no panel; what changed is the viewer's stylesheet
// and script, which now carry the tour player. The stylesheet counts twice
// because the viewer's export embeds its own CSS as a string. Nothing on the
// canvas moved. +10,549 bytes.
//
// Rebaselined for the readable first view (issue #24). The viewer script
// gains openView() and fitScale(), and GEOMETRY gains openAnchor, the box
// of the node the map opens on. Markup and script only: layout is
// untouched, and nothing on the canvas moved -- only where the camera
// starts. +1,229 bytes.
//
// Rebaselined for wrapped sublabels (issue #54). The sublabel is now a
// <text> of <tspan> lines rather than a single truncated <text>, which is
// a markup change only: every Medusa sublabel already fitted on one line,
// sublabelReserveExtra(doc.nodes) is 0, so the layout input is identical
// and nothing on the canvas moved. +600 bytes.
//
// Previous baselines:
//   the readable first view (#24):         237362 bytes /
//     b71d4994c3375812894f3f1c4b6376d7032deb88bff9a63a52038f28e3c46c32
//   wrapped sublabels (#54):                236133 bytes /
//     f7c008176559c6bd44c3317ad8aa25b1d5822ee4ea82eca5801c3ffd83425c6c
//   the status key (#56):                   235533 bytes /
//     8a23aa76ce5a65f93dbb5ed57df8bb102b952b44d241a2d7313be8572f58cc75
//   step 7c, export from the viewer:          231401 bytes /
//     04ba29eaeca0fd59d42444e260f91ee29a8400821f9b3b9db0b701fe2a113b3e
//   step 7a plus the Notes control:           213108 bytes /
//     553188edae93887619655aa4cfed93b555a18475265820e41e640e796f94a34c
//   step 7a, with the edge track:             212519 bytes /
//     5679c07cdb0a27864f72ecdd9bef0b62923ea8e017d3e95369af4e6c3a197d53
//   step 7a, before the edge-track fix:       208594 bytes /
//     48bd65285b79f5ccaa70100d664f2093448d5e108300e8eaa9dbbad06b0c4149
//   main@aa2bce7, before correction mode:     152693 bytes /
//     cdb130cbcda1a386f6bb506e437627fb4bcf3a39579ef1a1ba304aea45a19442
//   main@aee7b42, after CTO-M1-04:            152669 bytes /
//     6aa7fc9955fe255b14b5e926e76180263f4f921f0ba85a4cf8c0376dd0a09454
//   main@111a2f4, before the doc-export work: 151287 bytes /
//     9f1c3c4d7e1c41a28f43ff96b43229c05de53bbf771ae49bf6545daf2b4da9d6
//
// Recompute with:
//
//   node -e "
//     const crypto = require('crypto');
//     const fs = require('fs');
//     const { renderMap } = require('./src/n8n/index');
//     const doc = JSON.parse(fs.readFileSync('examples/medusa-return-flow.json', 'utf8'));
//     renderMap(doc).then(html => {
//       console.log(html.length, crypto.createHash('sha256').update(html).digest('hex'));
//     });
//   "
//
// If this test fails unexpectedly, the interactive output changed — that
// is exactly the regression it guards against. Rebaseline it only with a
// reason recorded above, the way CTO-M1-04 is.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const GOLDEN_LENGTH = 247911;
const GOLDEN_SHA256 = '1397d3ff97436e24da6215e97a0931760eb2a58c080a17014ef808e7eb9bef33';

test('renderMap(Medusa) is byte-identical to the note-connector-routing baseline', async () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const html = await renderMap(doc);
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  assert.strictEqual(html.length, GOLDEN_LENGTH, 'interactive HTML length changed');
  assert.strictEqual(hash, GOLDEN_SHA256, 'interactive HTML content changed');
});
