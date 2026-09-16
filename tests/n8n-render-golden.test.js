// The interactive HTML output must not change by accident. This pins
// `renderMap()` on the Medusa fixture so any drift has to be a decision
// somebody made deliberately.
//
// Rebaselined once, for CTO-M1-04 (sticky notes landing far from the
// nodes they annotate). That finding was raised against this very output,
// so fixing it necessarily changed it: attached notes are now placed
// beside what they name, a note whose targets are too far apart to sit
// beside carries a connector line, and layout settles note placement and
// edge routing against each other. Node positions, frames, edge routes,
// handles and the viewer script are otherwise untouched by that work.
//
// The previous baseline, taken at main@111a2f4 before the doc-export
// work, was 151287 bytes /
// 9f1c3c4d7e1c41a28f43ff96b43229c05de53bbf771ae49bf6545daf2b4da9d6.
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
const GOLDEN_LENGTH = 152669;
const GOLDEN_SHA256 = '6aa7fc9955fe255b14b5e926e76180263f4f921f0ba85a4cf8c0376dd0a09454';

test('renderMap(Medusa) is byte-identical to the CTO-M1-04 baseline', async () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const html = await renderMap(doc);
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  assert.strictEqual(html.length, GOLDEN_LENGTH, 'interactive HTML length changed');
  assert.strictEqual(hash, GOLDEN_SHA256, 'interactive HTML content changed');
});
