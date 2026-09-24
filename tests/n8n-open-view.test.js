// How the map opens (issue #24).
//
// Fitting the whole 40-node Medusa map into a 1440x900 window put its 16px
// labels at 5.5px on screen -- measured in headless Chromium, scale 0.344.
// Icons and no words, on the one glance that decides whether a founder
// keeps reading. The map now opens at a readable scale on its entry node
// when fitting would leave labels below 10px, and opens fitted exactly as
// before when it would not. Measured after: scale 0.625, 10px labels, the
// entry node on screen with its label 103px in from the left edge.
//
// What is asserted here is the part that does not need a browser: which
// box the viewer is told to open on, and that the script carries the rule.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { renderMap } = require('../src/n8n/index');
const { layoutMap } = require('../src/n8n/layout');

const MEDUSA = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'examples', 'medusa-return-flow.json'), 'utf8'),
);

function geometryOf(html) {
  const m = html.match(/var GEOMETRY = (\{[\s\S]*?\});\n/);
  assert.ok(m, 'the viewer carries no GEOMETRY');
  return JSON.parse(m[1]);
}

test('the viewer is told to open on the leftmost entry node', async () => {
  const layout = await layoutMap(MEDUSA);
  const geometry = geometryOf(await renderMap(MEDUSA));

  const entryBoxes = layout.entryIds.map(id => layout.nodeBoxes[id]);
  const leftmostX = Math.min(...entryBoxes.map(b => b.x));
  assert.ok(geometry.openAnchor, 'no anchor was given');
  assert.strictEqual(geometry.openAnchor.x, leftmostX);
  assert.ok(
    layout.entryIds.some(id => {
      const b = layout.nodeBoxes[id];
      return b.x === geometry.openAnchor.x && b.y === geometry.openAnchor.y;
    }),
    'the anchor is not an entry node',
  );
});

test('ties go to the topmost, so the choice is deterministic', async () => {
  const doc = {
    title: 'Two starts',
    nodes: [
      { id: 'low', label: 'Low start', kind: 'external' },
      { id: 'high', label: 'High start', kind: 'external' },
      { id: 'end', label: 'End', kind: 'artifact' },
    ],
    edges: [
      { from: 'low', to: 'end', type: 'solid' },
      { from: 'high', to: 'end', type: 'solid' },
    ],
  };
  const layout = await layoutMap(doc);
  const anchor = geometryOf(await renderMap(doc)).openAnchor;
  const starts = ['low', 'high'].map(id => layout.nodeBoxes[id]);
  const topmost = starts.filter(b => b.x === anchor.x).sort((a, b) => a.y - b.y)[0];
  assert.strictEqual(anchor.y, topmost.y);
});

test('the anchor is a bare numeric box, as GEOMETRY requires', async () => {
  const anchor = geometryOf(await renderMap(MEDUSA)).openAnchor;
  assert.deepStrictEqual(Object.keys(anchor).sort(), ['h', 'w', 'x', 'y']);
  Object.values(anchor).forEach(v => assert.strictEqual(typeof v, 'number'));
});

test('the script opens with openView, and Fit still fits', async () => {
  const html = await renderMap(MEDUSA);
  assert.match(html, /\n  openView\(\);\n/, 'the map does not open through openView');
  assert.match(html, /getElementById\('zoom-fit'\)\.addEventListener\('click', fit\)/);
  // 16px labels at 10px or larger is the whole rule.
  assert.match(html, /var READABLE_SCALE = 10 \/ 16;/);
});

// The decision itself, run against the real script: a window that fits the
// map readably opens fitted; one that does not opens at READABLE_SCALE on
// the anchor.
async function runOpenView(width, height) {
  const html = await renderMap(MEDUSA);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const fitFn = script.match(/function fitScale\(rect\)\{[\s\S]*?\n  \}\n/)[0];
  const openFn = script.match(/var READABLE_SCALE[\s\S]*?function openView\(\)\{[\s\S]*?\n  \}\n/)[0];
  const canvas = script.match(/var CANVAS = (\{[^;]*\});/)[1];
  const geometry = script.match(/var GEOMETRY = (\{[\s\S]*?\});\n/)[1];
  const sandbox = { state: { x: 0, y: 0, scale: 1 }, calls: [] };
  vm.createContext(sandbox);
  vm.runInContext(
    `var CANVAS = ${canvas}; var GEOMETRY = ${geometry};
     var MIN_SCALE = 0.1, MAX_SCALE = 4;
     var stage = { getBoundingClientRect: function(){ return { width: ${width}, height: ${height} }; } };
     function apply(){ calls.push('apply'); }
     function fit(){ calls.push('fit'); }
     ${fitFn}${openFn}
     openView();`,
    sandbox,
  );
  return sandbox;
}

test('a window too small to fit readably opens at the readable scale', async () => {
  const s = await runOpenView(1440, 900);
  assert.deepStrictEqual(s.calls, ['apply']);
  assert.strictEqual(s.state.scale, 10 / 16);
});

test('a window large enough to fit readably still opens fitted', async () => {
  const s = await runOpenView(20000, 12000);
  assert.deepStrictEqual(s.calls, ['fit']);
});
