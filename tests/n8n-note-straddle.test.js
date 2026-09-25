// Notes and frame borders (issue #36).
//
// A note half across a frame border reads as belonging to neither side.
// The obvious fix -- rejecting such a placement outright -- was tried in
// #35 and reverted: by REMOVING candidates it pushed two notes in another
// layer set onto connectors (0 -> 2, worst gap 24px -> 256px), and every
// existing test still passed, because the proximity test accepts a
// connector as a valid alternative to being close.
//
// So two things are pinned here. The straddle is fixed where #36 saw it.
// And -- the part the issue asked for, and the part that matters more --
// the connector count and worst gap in EVERY layer set are pinned, so a
// future change that quietly trades good placement for connectors fails
// a test instead of passing all of them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validateDoc } = require('../src/n8n/validate');
const { filterDocForLayers } = require('../src/n8n/doc-filter');
const { layoutValidated } = require('../src/n8n/layout');
const { captionReserveExtra } = require('../src/n8n/captions');
const { rectGap } = require('../src/n8n/notes');
const { LABEL_RESERVE } = require('../src/n8n/constants');

const MEDUSA = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'examples', 'medusa-return-flow.json'), 'utf8'),
);

const inside = (a, f) => a.x >= f.x && a.y >= f.y && a.x + a.w <= f.x + f.w && a.y + a.h <= f.y + f.h;
const overlap = (a, f) => a.x < f.x + f.w && a.x + a.w > f.x && a.y < f.y + f.h && a.y + a.h > f.y;

// The documentation export lays out only the layers asked for, so each
// combination is a different layout. Mirrors render-doc.js buildDocSvg.
async function measure(layers) {
  const filtered = filterDocForLayers(validateDoc(MEDUSA), layers);
  const labelReserve = LABEL_RESERVE + captionReserveExtra(filtered.nodes);
  const layout = await layoutValidated(filtered, { labelReserve });
  const straddlers = [];
  let connectors = 0;
  let worst = 0;
  for (const [id, n] of Object.entries(layout.noteBoxes)) {
    connectors += (n.connectors || []).length;
    for (const [fid, f] of Object.entries(layout.frameBoxes)) {
      if (overlap(n, f) && !inside(n, f)) straddlers.push(`${id}/${fid}`);
    }
    const note = filtered.notes.find(x => x.id === id);
    (note.attachTo || []).forEach(t => {
      const box = layout.nodeBoxes[t] || layout.frameBoxes[t];
      if (box) worst = Math.max(worst, rectGap(n, box));
    });
  }
  return { straddlers, connectors, worst: Math.round(worst) };
}

test('n_inspection sits wholly inside or outside the Fulfillment frame (#36)', async () => {
  for (const layers of [['base', 'business'], ['base', 'business', 'build']]) {
    const { straddlers } = await measure(layers);
    assert.ok(
      !straddlers.includes('n_inspection/g_ship'),
      `${layers.join('+')}: n_inspection still straddles g_ship`,
    );
  }
});

// Measured on this change. Identical to the numbers before it, in every
// set: the straddle fix cost no connector and moved no note further from
// its target. A change that raises either number must say why.
const PINNED = {
  'base': { connectors: 0, worst: 0 },
  'base+edge': { connectors: 0, worst: 144 },
  'base+business': { connectors: 1, worst: 740 },
  'base+edge+business': { connectors: 2, worst: 884 },
  'base+build': { connectors: 0, worst: 0 },
  'base+edge+build': { connectors: 0, worst: 167 },
  'base+business+build': { connectors: 1, worst: 777 },
  'base+edge+business+build': { connectors: 2, worst: 928 },
};

for (const [key, expected] of Object.entries(PINNED)) {
  test(`${key}: connectors and worst gap are unchanged`, async () => {
    const got = await measure(key.split('+'));
    assert.strictEqual(got.connectors, expected.connectors, `${key}: connector count moved`);
    assert.strictEqual(got.worst, expected.worst, `${key}: worst note-to-target gap moved`);
  });
}

test('straddles fell from 6 to 3 across all layer sets, and never rise', async () => {
  let total = 0;
  for (const key of Object.keys(PINNED)) total += (await measure(key.split('+'))).straddlers.length;
  // The three that remain are notes where every non-straddling spot is
  // worse on reach or on blocked edge paths. Leaving them is the ranking
  // working as designed, not a miss: those two outrank a tidy border.
  assert.ok(total <= 3, `${total} straddles`);
});
