// The viewer recomputes a frame's box whenever a layer is toggled, and it
// must use the same label reserve layout used.
//
// They drifted apart when sublabels began to wrap (#54): layout grows the
// strip below every node by sublabelReserveExtra(), while the viewer kept
// recomputing frames with the bare LABEL_RESERVE constant. On a map with a
// wrapped sublabel, the first layer toggle shrank every frame 15px and cut
// through the sublabel's second line. Nothing on the initial render showed
// it, which is why the golden test did not catch it: the initial frames
// come from layout, and only the recomputation used the wrong number.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');
const { layoutMap } = require('../src/n8n/layout');
const { LABEL_RESERVE, SUBLABEL_LINE_HEIGHT } = require('../src/n8n/constants');

function geometryOf(html) {
  const m = html.match(/var GEOMETRY = (\{[\s\S]*?\});\n/);
  assert.ok(m, 'the viewer carries no GEOMETRY');
  return JSON.parse(m[1]);
}

function docWithWrappedSublabel() {
  return {
    title: 'Wrapped sublabel',
    groups: [{ id: 'g', label: 'Group' }],
    nodes: [
      { id: 'a', label: 'Quote sent', kind: 'service', parentId: 'g', sublabel: 'chases unanswered quotes' },
      { id: 'b', label: 'Paid', kind: 'artifact', parentId: 'g' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
  };
}

test('the viewer recomputes frames with the reserve layout actually used', async () => {
  const doc = docWithWrappedSublabel();
  const layout = await layoutMap(doc);
  const geometry = geometryOf(await renderMap(doc));

  assert.strictEqual(geometry.labelReserve, layout.labelReserve);
  // And that number is not the bare constant -- which is the whole bug.
  assert.strictEqual(layout.labelReserve, LABEL_RESERVE + SUBLABEL_LINE_HEIGHT);
});

test('on a map whose sublabels all fit, the reserve is still the constant', async () => {
  const doc = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'examples', 'medusa-return-flow.json'), 'utf8'),
  );
  const geometry = geometryOf(await renderMap(doc));
  assert.strictEqual(geometry.labelReserve, LABEL_RESERVE);
});
