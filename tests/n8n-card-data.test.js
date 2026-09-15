// Card data (docs/design/n8n-visual-style.md "Details card"): pure,
// testable per-node/per-edge summaries built by src/n8n/card-data.js.
// Connections are derived from doc.edges, so every map gets
// "Receives from" / "Sends to" even with no edge descriptions authored,
// and must match the edges exactly. Ordering must be deterministic.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { layoutMap } = require('../src/n8n/layout');
const { buildCardData } = require('../src/n8n/card-data');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('buildCardData on the Medusa fixture', () => {
  let layout;
  let cardData;

  test('layoutMap and buildCardData resolve without throwing', async () => {
    layout = await layoutMap(doc);
    cardData = buildCardData(doc, layout);
    assert.ok(cardData.nodes);
    assert.ok(cardData.edges);
  });

  test('every node in the doc gets exactly one card entry', () => {
    assert.strictEqual(cardData.nodes.length, doc.nodes.length);
    const ids = cardData.nodes.map(n => n.id).sort();
    const docIds = doc.nodes.map(n => n.id).sort();
    assert.deepStrictEqual(ids, docIds);
  });

  test('every edge in the doc gets exactly one card entry, same order as doc.edges', () => {
    assert.strictEqual(cardData.edges.length, doc.edges.length);
    cardData.edges.forEach((e, i) => {
      assert.strictEqual(e.from, doc.edges[i].from);
      assert.strictEqual(e.to, doc.edges[i].to);
    });
  });

  test('node ordering is by layout position, left to right then top to bottom', () => {
    for (let i = 1; i < cardData.nodes.length; i++) {
      const prev = layout.nodeBoxes[cardData.nodes[i - 1].id];
      const cur = layout.nodeBoxes[cardData.nodes[i].id];
      const inOrder = prev.x < cur.x || (prev.x === cur.x && prev.y <= cur.y);
      assert.ok(inOrder, `${cardData.nodes[i - 1].id} (${prev.x},${prev.y}) should sort before ${cardData.nodes[i].id} (${cur.x},${cur.y})`);
    }
  });

  test('ordering is deterministic across repeated runs', async () => {
    const layout2 = await layoutMap(doc);
    const cardData2 = buildCardData(doc, layout2);
    assert.deepStrictEqual(
      cardData2.nodes.map(n => n.id),
      cardData.nodes.map(n => n.id),
    );
    assert.deepStrictEqual(
      cardData2.nodes.map(n => n.receivesFrom.map(c => c.nodeId)),
      cardData.nodes.map(n => n.receivesFrom.map(c => c.nodeId)),
    );
  });

  test('receivesFrom/sendsTo match doc.edges exactly, including conditions and types', () => {
    const byId = new Map(cardData.nodes.map(n => [n.id, n]));

    // Rebuild the expected connection sets straight from doc.edges, then
    // compare as sets (ordering is asserted separately above) against what
    // buildCardData produced.
    const expectedReceives = new Map();
    const expectedSends = new Map();
    doc.nodes.forEach(n => {
      expectedReceives.set(n.id, []);
      expectedSends.set(n.id, []);
    });
    doc.edges.forEach(e => {
      expectedSends.get(e.from).push({ nodeId: e.to, edgeDescription: e.description || null, condition: e.condition || null, type: e.type || 'solid' });
      expectedReceives.get(e.to).push({ nodeId: e.from, edgeDescription: e.description || null, condition: e.condition || null, type: e.type || 'solid' });
    });

    const sortKey = c => `${c.nodeId}|${c.condition}|${c.edgeDescription}|${c.type}`;
    doc.nodes.forEach(n => {
      const card = byId.get(n.id);
      const actualReceives = card.receivesFrom.map(c => ({ nodeId: c.nodeId, edgeDescription: c.edgeDescription, condition: c.condition, type: c.type }));
      const actualSends = card.sendsTo.map(c => ({ nodeId: c.nodeId, edgeDescription: c.edgeDescription, condition: c.condition, type: c.type }));
      assert.deepStrictEqual(
        actualReceives.slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
        expectedReceives.get(n.id).slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
        `receivesFrom mismatch for ${n.id}`,
      );
      assert.deepStrictEqual(
        actualSends.slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
        expectedSends.get(n.id).slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
        `sendsTo mismatch for ${n.id}`,
      );
    });
  });

  test('a node with no incident edges gets empty receivesFrom/sendsTo, not missing fields', () => {
    // Every card node always carries both arrays, even when empty, so a
    // map with no descriptions authored anywhere still gets full
    // connection lists derived purely from the edges.
    cardData.nodes.forEach(n => {
      assert.ok(Array.isArray(n.receivesFrom));
      assert.ok(Array.isArray(n.sendsTo));
    });
  });

  test('pay_provider (a node with a description and a link) carries both on its card', () => {
    const card = cardData.nodes.find(n => n.id === 'pay_provider');
    assert.ok(card);
    assert.strictEqual(card.description, "Stripe issues the refund to the customer's original payment method.");
    assert.strictEqual(card.link, 'https://docs.stripe.com/refunds');
    assert.ok(card.receivesFrom.some(c => c.nodeId === 'pay_mod'));
    assert.ok(card.sendsTo.some(c => c.nodeId === 'order_txn'));
  });

  test('prompt is only carried for status:"open" nodes, rationale only for status:"suggested"', () => {
    cardData.nodes.forEach(n => {
      const docNode = doc.nodes.find(d => d.id === n.id);
      if (docNode.status !== 'open') assert.strictEqual(n.prompt, null);
      if (docNode.status !== 'suggested') assert.strictEqual(n.rationale, null);
    });
  });

  test('group carries the group label, not the raw group id', () => {
    const card = cardData.nodes.find(n => n.id === 'pay_provider');
    assert.strictEqual(card.group, 'Payment'); // g_money's label in the fixture
  });
});

describe('buildCardData on a minimal doc (no groups, no descriptions)', () => {
  test('still produces full connection lists', () => {
    const minimal = {
      title: 'Minimal',
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'dashed', condition: 'on success' }],
    };
    const layout = { nodeBoxes: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } } };
    const cardData = buildCardData(minimal, layout);
    const a = cardData.nodes.find(n => n.id === 'a');
    const b = cardData.nodes.find(n => n.id === 'b');
    assert.strictEqual(a.group, null);
    assert.deepStrictEqual(a.sendsTo, [{ nodeId: 'b', label: 'B', edgeDescription: null, condition: 'on success', type: 'dashed' }]);
    assert.deepStrictEqual(b.receivesFrom, [{ nodeId: 'a', label: 'A', edgeDescription: null, condition: 'on success', type: 'dashed' }]);
  });
});
