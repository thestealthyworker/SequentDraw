// Tours in the viewer (build step 8; docs/SPEC.md "Tours").
//
// What is asserted here is what the engine emits and what the patch does.
// The player itself -- stepping, spotlighting, layers restored on exit --
// was driven in a real browser for this PR; see its description.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { renderMap } = require('../src/n8n/index');
const { tourSteps, tourScript } = require('../src/n8n/render-tour');
const { applyPatch } = require('../src/n8n/merge');
const { validateDoc } = require('../src/n8n/validate');

function doc(tour) {
  const d = {
    title: 'Tour fixture',
    nodes: [
      { id: 'a', label: 'Enquiry', kind: 'external' },
      { id: 'b', label: 'Quote', kind: 'manual' },
      { id: 'c', label: 'Paid', kind: 'artifact', layers: ['business'] },
    ],
    edges: [
      { from: 'a', to: 'b', type: 'solid' },
      { from: 'b', to: 'c', type: 'solid' },
    ],
  };
  if (tour) d.tour = tour;
  return d;
}

const TOUR = [
  { order: 2, title: 'Then a quote', description: 'The owner prices it.', nodeIds: ['b'] },
  { order: 1, title: 'Work arrives', description: 'A customer asks.', nodeIds: ['a'] },
  { order: 3, title: 'Paid', description: 'Money in.', nodeIds: ['b', 'c'] },
];

describe('the viewer', () => {
  test('offers a tour only when the map has one', async () => {
    assert.match(await renderMap(doc(TOUR)), /id="tour-start"/);
    assert.doesNotMatch(await renderMap(doc()), /id="tour-start"/);
    assert.doesNotMatch(await renderMap(doc([])), /id="tour-start"/);
  });

  test('the button says how long the tour is', async () => {
    assert.match(await renderMap(doc(TOUR)), /Take the tour <span class="tour-start-count">3 steps<\/span>/);
    assert.match(await renderMap(doc([TOUR[0]])), /1 step</);
  });

  test('steps play in `order`, not in array order', () => {
    assert.deepStrictEqual(tourSteps(doc(TOUR)).map(s => s.order), [1, 2, 3]);
  });

  test('the emitted script parses', async () => {
    const html = await renderMap(doc(TOUR));
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(script));
  });

  test('tour text reaches the page through textContent only', () => {
    const script = tourScript();
    assert.match(script, /\.textContent = String\(step\.title/);
    assert.match(script, /\.textContent = String\(step\.description/);
    assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML/);
  });

  test('a hostile title or narration never becomes markup', async () => {
    const hostile = [{ order: 1, title: '</script><img src=x onerror=alert(1)>', description: '<b>x</b>', nodeIds: ['a'] }];
    const html = await renderMap(doc(hostile));
    assert.strictEqual((html.match(/<script>/g) || []).length, 1, 'a second script element appeared');
    assert.doesNotMatch(html, /<img src=x/);
  });

  // The invariant the whole product rests on: layout's coordinates are never
  // changed. The tour may move the camera (state + apply()) and toggle
  // visibility classes; it must never write a node's position.
  test('the tour never moves a node, only the camera', () => {
    const script = tourScript();
    assert.doesNotMatch(script, /setAttribute\(\s*['"](transform|x|y|cx|cy|d)['"]/);
    assert.doesNotMatch(script, /\.style\.(left|top|transform)/);
    assert.match(script, /state\.scale = scale;/);
    assert.match(script, /apply\(\);/);
  });

  test('leaving the tour restores the reader\'s layers', () => {
    const script = tourScript();
    assert.match(script, /tourSavedLayers = checkboxes\.map/);
    assert.match(script, /cb\.checked = tourSavedLayers\[i\]/);
  });

  test('a step only ever turns a layer ON', () => {
    // tourRevealLayers sets checked = true and never false.
    const reveal = tourScript().match(/function tourRevealLayers[\s\S]*?\n  }\n/)[0];
    assert.match(reveal, /cb\.checked = true/);
    assert.doesNotMatch(reveal, /cb\.checked = false/);
  });
});

describe('--merge and the tour', () => {
  test('a patch sets the tour', () => {
    const { doc: merged, errors } = applyPatch(doc(), { tour: TOUR });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(merged.tour, TOUR);
    assert.doesNotThrow(() => validateDoc(merged));
  });

  test('a patch REPLACES the tour rather than merging steps', () => {
    // Merging numbered steps could leave two step 3s or a gap; a tour is one
    // ordered narrative, so it is replaced whole.
    const { doc: merged } = applyPatch(doc(TOUR), { tour: [TOUR[1]] });
    assert.deepStrictEqual(merged.tour, [TOUR[1]]);
  });

  test('an empty tour removes it', () => {
    const { doc: merged } = applyPatch(doc(TOUR), { tour: [] });
    assert.strictEqual('tour' in merged, false);
  });

  test('a tour that is not a list of objects is refused, and nothing is produced', () => {
    for (const bad of ['steps', [1, 2], { order: 1 }]) {
      const { doc: merged, errors } = applyPatch(doc(), { tour: bad });
      assert.strictEqual(merged, null);
      assert.ok(errors.length > 0, JSON.stringify(bad));
    }
  });

  test('a tour naming a node that does not exist fails validation after the merge', () => {
    const { doc: merged } = applyPatch(doc(), { tour: [{ order: 1, title: 't', description: 'd', nodeIds: ['ghost'] }] });
    assert.throws(() => validateDoc(merged));
  });

  test('removing a node a tour step names is caught, not silently kept', () => {
    const { doc: merged } = applyPatch(doc(TOUR), { remove: { nodes: ['c'] } });
    assert.throws(() => validateDoc(merged), 'a step still names the removed node');
  });
});
