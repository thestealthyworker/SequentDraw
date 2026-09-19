// Reading order of a business map's happy path (docs/reviews/m2/round-1.md,
// CTO-M2-01). A layered layout ranks a node one column after the nodes that
// point at it, so the money leg reads left to right only when the spine is
// continuous: every step carries an edge from the step before it. The
// interview writes it that way (skills/business-map/references/interview.md,
// "How the edges go"); these tests pin the engine behaviour that rule relies
// on.
//
// Both documents below carry the participation edges a business map really
// has -- the customer starts the process AND pays, the owner acts early AND
// sees the money land -- because those are what made the original map read
// backwards. What differs between the two is one spine edge.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { validateDoc } = require('../src/n8n/validate');
const { layoutMap } = require('../src/n8n/layout');

// enquiry -> quote -> clean -> invoice -> paid, with Customer and Owner
// taking part at both ends of it.
function cleaningMap({ spineToPayment }) {
  const node = (id, label, kind, layers) => ({ id, label, kind, layers });
  const edges = [
    { from: 'customer', to: 'form', type: 'solid' },
    { from: 'form', to: 'quote', type: 'solid' },
    { from: 'owner', to: 'quote', type: 'solid' },
    { from: 'quote', to: 'clean', type: 'solid' },
    { from: 'cleaner', to: 'clean', type: 'solid' },
    { from: 'clean', to: 'invoice', type: 'solid' },
    { from: 'customer', to: 'paid', type: 'solid' },
    { from: 'paid', to: 'owner', type: 'solid' },
  ];
  if (spineToPayment) edges.push({ from: 'invoice', to: 'paid', type: 'solid' });
  return {
    title: 'How a cleaning booking becomes a paid job',
    nodes: [
      node('customer', 'Customer', 'external', ['business']),
      node('form', 'Website enquiry form', 'service', ['base']),
      node('owner', 'Owner', 'human', ['business']),
      node('quote', 'Send quote', 'manual', ['base', 'business']),
      node('cleaner', 'Dana', 'human', ['business']),
      node('clean', 'Clean the property', 'manual', ['base', 'business']),
      node('invoice', 'Invoice email', 'service', ['base']),
      node('paid', 'Bank transfer', 'manual', ['base', 'business']),
    ],
    edges,
  };
}

async function columnsOf(doc) {
  const layout = await layoutMap(validateDoc(doc));
  const x = id => layout.nodeBoxes[id].x;
  return { x };
}

describe('a business map reads left to right when its spine is continuous', () => {
  test('the payment step is drawn after the invoice that asks for it', async () => {
    const { x } = await columnsOf(cleaningMap({ spineToPayment: true }));
    assert.ok(
      x('paid') > x('invoice'),
      `"Bank transfer" (x=${x('paid')}) must sit right of "Invoice email" (x=${x('invoice')})`
    );
  });

  test('no step of the money leg is drawn left of the trigger', async () => {
    const { x } = await columnsOf(cleaningMap({ spineToPayment: true }));
    assert.ok(
      x('paid') > x('form'),
      `"Bank transfer" (x=${x('paid')}) must sit right of the enquiry form (x=${x('form')})`
    );
  });

  test('the whole happy path is in order', async () => {
    const { x } = await columnsOf(cleaningMap({ spineToPayment: true }));
    const path = ['form', 'quote', 'clean', 'invoice', 'paid'];
    path.slice(1).forEach((id, i) => {
      const before = path[i];
      assert.ok(x(id) > x(before), `${id} (x=${x(id)}) must sit right of ${before} (x=${x(before)})`);
    });
  });

  test('participation edges alone do not carry the flow: the missing spine edge is what breaks it', async () => {
    // The defect CTO-M2-01 recorded. Kept as a test so the reason the
    // interview rule exists stays demonstrable: with `invoice -> paid`
    // missing, the payment step is reached only through the customer, who
    // is where the map starts, and it lands in the map's first columns.
    const { x } = await columnsOf(cleaningMap({ spineToPayment: false }));
    assert.ok(
      x('paid') < x('invoice'),
      'without the spine edge the payment step is no longer drawn before the invoice; '
        + 'if the layout now handles this on its own, delete this test and simplify the interview rule'
    );
  });
});
