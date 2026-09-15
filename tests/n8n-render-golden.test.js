// Documentation-export branch (feat/doc-export) requirement: the
// interactive HTML output must not change. This hash was computed from
// `renderMap()` on the Medusa fixture at main@111a2f4, BEFORE any of the
// doc-export layout/render parameterisation (labelReserve threading
// through layout.js, layout-flat.js, elk-helpers.js, obstacles.js,
// notes.js) landed:
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
// If this test ever needs to change, the interactive output changed —
// that is exactly the regression this guards against.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const GOLDEN_LENGTH = 151287;
const GOLDEN_SHA256 = '9f1c3c4d7e1c41a28f43ff96b43229c05de53bbf771ae49bf6545daf2b4da9d6';

test('renderMap(Medusa) is byte-identical to main before the doc-export change', async () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const html = await renderMap(doc);
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  assert.strictEqual(html.length, GOLDEN_LENGTH, 'interactive HTML length changed');
  assert.strictEqual(hash, GOLDEN_SHA256, 'interactive HTML content changed');
});
