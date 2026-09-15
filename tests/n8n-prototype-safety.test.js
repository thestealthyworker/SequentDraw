// Security follow-up (review of this branch): node ids are
// author-controlled, and ID_RE (`^[A-Za-z0-9_.:-]{1,64}$`) legally allows
// "__proto__", "constructor" and "toString" as ids. Every id-keyed lookup
// table this feature builds -- in card-data.js (Maps, already safe),
// layout.js, render.js and render-shell.js's viewer script -- must use a
// Map or an Object.create(null) table, never a plain {}, or a node with
// one of these ids would silently reach the object's prototype chain
// instead of being stored as its own entry: `table['__proto__'] = node`
// on a plain {} reassigns the object's *prototype*, not an own property.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { renderMap } = require('../src/n8n/index');
const { layoutMap } = require('../src/n8n/layout');
const { buildCardData } = require('../src/n8n/card-data');
const { validateDoc } = require('../src/n8n/validate');

const TRICKY_IDS = ['__proto__', 'constructor', 'toString'];

function trickyDoc() {
  return {
    title: 'Prototype-hazard ids',
    nodes: TRICKY_IDS.map((id, i) => ({
      id,
      label: `Node ${i}`,
      kind: 'service',
      description: `This is node "${id}".`,
    })).concat([{ id: 'anchor', label: 'Anchor', kind: 'service' }]),
    edges: TRICKY_IDS.map(id => ({ from: id, to: 'anchor', type: 'solid', condition: null })),
  };
}

describe('ids that collide with Object.prototype members never get lost', () => {
  test('validateDoc accepts all three tricky ids (ID_RE has no special case for them)', () => {
    assert.doesNotThrow(() => validateDoc(trickyDoc()));
  });

  test('layoutMap places all 4 nodes, including the 3 tricky ones, each with its own box', async () => {
    const layout = await layoutMap(trickyDoc());
    TRICKY_IDS.concat(['anchor']).forEach(id => {
      assert.ok(layout.nodeBoxes[id], `node "${id}" should have its own box, not the object's prototype`);
      assert.strictEqual(typeof layout.nodeBoxes[id].x, 'number');
    });
    // Object.keys/Object.entries -- what everything downstream iterates
    // with -- must see all 4 as real own properties.
    assert.strictEqual(Object.keys(layout.nodeBoxes).length, 4);
  });

  test('buildCardData resolves each tricky id to its OWN node, not a shared prototype object', async () => {
    const doc = validateDoc(trickyDoc());
    const layout = await layoutMap(doc);
    const cardData = buildCardData(doc, layout);
    TRICKY_IDS.forEach(id => {
      const card = cardData.nodes.find(n => n.id === id);
      assert.ok(card, `card data should include a node for id "${id}"`);
      assert.strictEqual(card.description, `This is node "${id}".`);
    });
    // Exactly 4 node cards -- none silently merged or dropped.
    assert.strictEqual(cardData.nodes.length, 4);
  });

  test('renderMap resolves without throwing and embeds all 4 nodes exactly once each', async () => {
    const html = await renderMap(trickyDoc());
    TRICKY_IDS.concat(['anchor']).forEach(id => {
      const occurrences = html.split(`data-id="${id}"`).length - 1;
      assert.strictEqual(occurrences, 1, `expected exactly one node <g> for id "${id}", found ${occurrences}`);
    });
  });
});
