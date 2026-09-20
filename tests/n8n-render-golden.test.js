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
// Previous baselines:
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
const GOLDEN_LENGTH = 212519;
const GOLDEN_SHA256 = '5679c07cdb0a27864f72ecdd9bef0b62923ea8e017d3e95369af4e6c3a197d53';

test('renderMap(Medusa) is byte-identical to the note-connector-routing baseline', async () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const html = await renderMap(doc);
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  assert.strictEqual(html.length, GOLDEN_LENGTH, 'interactive HTML length changed');
  assert.strictEqual(hash, GOLDEN_SHA256, 'interactive HTML content changed');
});
