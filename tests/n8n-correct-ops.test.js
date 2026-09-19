// The correction operations the viewer offers in correction mode
// (docs/design/correction-mode.md, build step 7a). Pure module, tested
// here against the same functions render-shell.js inlines verbatim for
// the browser.
//
// Every test asserts two things: the change the operation makes, and that
// nothing else in the document moved. The second half is the point -- a
// correction the user did not ask for is worse than one they did.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { applyOp, guard, describeOp } = require('../src/n8n/correct-ops');
const { validateDoc } = require('../src/n8n/validate');

// A small business map with everything the operations touch: two groups,
// a suggested node that cites two others, a note attached to a node, an
// open node, and a conditional edge.
function baseDoc() {
  return {
    title: 'How a booking becomes a paid job',
    groups: [
      { id: 'g_intake', label: 'Intake', color: 'blue' },
      { id: 'g_money', label: 'Money', color: 'green' },
    ],
    nodes: [
      { id: 'customer', label: 'Customer', kind: 'external', layers: ['business'], parentId: 'g_intake' },
      { id: 'form', label: 'Enquiry form', kind: 'service', icon: 'typeform', layers: ['base'], parentId: 'g_intake' },
      { id: 'quote', label: 'Send quote', kind: 'manual', layers: ['base', 'business'], parentId: 'g_intake' },
      { id: 'invoice', label: 'Invoice', kind: 'artifact', layers: ['business'], parentId: 'g_money' },
      { id: 'paid', label: 'Bank transfer', kind: 'manual', layers: ['base', 'business'], parentId: 'g_money' },
      { id: 'q_chaser', label: 'Who chases this?', kind: 'human', status: 'open', prompt: 'Nobody is named as chasing a silent quote.', layers: ['edge'] },
      {
        id: 's_xero',
        label: 'Xero',
        kind: 'service',
        icon: 'xero',
        status: 'suggested',
        integration: 'xero',
        rationale: 'Raises the invoice and reconciles the bank transfer against it.',
        cites: ['invoice', 'paid'],
        layers: ['base'],
      },
    ],
    edges: [
      { from: 'customer', to: 'form', type: 'solid' },
      { from: 'form', to: 'quote', type: 'solid' },
      { from: 'quote', to: 'invoice', type: 'solid' },
      { from: 'invoice', to: 'paid', type: 'solid' },
      { from: 'quote', to: 'q_chaser', type: 'dashed', condition: 'no reply' },
      { from: 'invoice', to: 's_xero', type: 'dashed' },
    ],
    notes: [
      { id: 'n_cap', content: 'Refunds over 500 need a second signature.', attachTo: ['paid'], color: 'gold', layers: ['base'] },
    ],
  };
}

function nodeById(doc, id) {
  return doc.nodes.find(n => n.id === id);
}

function apply(doc, op) {
  assert.strictEqual(guard(doc, op), null, `expected ${op.type} to be allowed`);
  return applyOp(doc, op);
}

describe('applyOp leaves the input document untouched', () => {
  test('the original is deep-equal to a fresh copy afterwards', () => {
    const doc = baseDoc();
    apply(doc, { type: 'set-kind', node: 'form', kind: 'manual' });
    assert.deepStrictEqual(doc, baseDoc());
  });
});

describe('1. reattach a connection', () => {
  test('moves the chosen end and keeps type and condition', () => {
    const doc = baseDoc();
    const next = apply(doc, { type: 'reattach-edge', index: 4, end: 'from', node: 'form' });
    assert.deepStrictEqual(next.edges[4], { from: 'form', to: 'q_chaser', type: 'dashed', condition: 'no reply' });
    assert.deepStrictEqual(next.nodes, doc.nodes);
  });

  test('refuses an edge to itself', () => {
    const refusal = guard(baseDoc(), { type: 'reattach-edge', index: 1, end: 'to', node: 'form' });
    assert.strictEqual(refusal.code, 'self-edge');
  });

  test('refuses a duplicate of an edge that already exists', () => {
    // Edge 5 is invoice -> Xero; edge 3 is already invoice -> paid.
    const refusal = guard(baseDoc(), { type: 'reattach-edge', index: 5, end: 'to', node: 'paid' });
    assert.strictEqual(refusal.code, 'duplicate-edge');
  });

  test('refuses a reattachment that would strand the node it leaves', () => {
    // Edge 4 is the only edge on "Who chases this?".
    const refusal = guard(baseDoc(), { type: 'reattach-edge', index: 4, end: 'to', node: 'customer' });
    assert.strictEqual(refusal.code, 'would-strand-node');
    assert.match(refusal.message, /Who chases this\?/);
  });

  test('refuses an unknown node or an index off the end', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'reattach-edge', index: 1, end: 'to', node: 'nope' }).code, 'unknown-node');
    assert.strictEqual(guard(baseDoc(), { type: 'reattach-edge', index: 99, end: 'to', node: 'form' }).code, 'unknown-edge');
  });
});

describe('2. delete a connection', () => {
  test('removes exactly that edge', () => {
    const doc = baseDoc();
    const next = apply(doc, { type: 'delete-edge', index: 2 });
    assert.strictEqual(next.edges.length, 5);
    assert.ok(!next.edges.some(e => e.from === 'quote' && e.to === 'invoice'));
    assert.deepStrictEqual(next.nodes, doc.nodes);
  });

  test('refuses a deletion that would strand the suggestion it feeds', () => {
    const refusal = guard(baseDoc(), { type: 'delete-edge', index: 5 });
    assert.strictEqual(refusal.code, 'would-strand-node');
    assert.deepStrictEqual(refusal.fix, [{ type: 'delete-node', node: 's_xero' }]);
  });

  test('refuses when it would strand a node, and offers to delete it', () => {
    const doc = baseDoc();
    const refusal = guard(doc, { type: 'delete-edge', index: 4 });
    assert.strictEqual(refusal.code, 'would-strand-node');
    assert.match(refusal.message, /Who chases this\?/);
    assert.deepStrictEqual(refusal.fix, [{ type: 'delete-node', node: 'q_chaser' }]);
  });

  test('allows it when the stranded node would be alone in its group', () => {
    const doc = baseDoc();
    doc.nodes.push({ id: 'lonely', label: 'Lonely', kind: 'service', layers: ['base'], parentId: 'g_solo' });
    doc.groups.push({ id: 'g_solo', label: 'Solo', color: 'gray' });
    doc.edges.push({ from: 'paid', to: 'lonely', type: 'solid' });
    assert.strictEqual(guard(doc, { type: 'delete-edge', index: 6 }), null);
  });
});

describe('3. move a node to another group', () => {
  test('sets parentId and marks the node as corrected by the user', () => {
    const doc = baseDoc();
    const next = apply(doc, { type: 'set-group', node: 'paid', group: 'g_intake' });
    assert.strictEqual(nodeById(next, 'paid').parentId, 'g_intake');
    assert.strictEqual(nodeById(next, 'paid').source, 'user');
  });

  test('ungroups with a null group', () => {
    const next = apply(baseDoc(), { type: 'set-group', node: 'paid', group: null });
    assert.strictEqual(nodeById(next, 'paid').parentId, null);
  });

  test('refuses a group that does not exist', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'set-group', node: 'paid', group: 'g_nope' }).code, 'unknown-group');
  });
});

describe('4. change which layers a node is on', () => {
  test('replaces the layer set', () => {
    const next = apply(baseDoc(), { type: 'set-layers', node: 'quote', layers: ['base'] });
    assert.deepStrictEqual(nodeById(next, 'quote').layers, ['base']);
  });

  test('refuses an empty set, an unknown layer and a repeat', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'set-layers', node: 'quote', layers: [] }).code, 'no-layers');
    assert.strictEqual(guard(baseDoc(), { type: 'set-layers', node: 'quote', layers: ['nope'] }).code, 'unknown-layer');
    assert.strictEqual(guard(baseDoc(), { type: 'set-layers', node: 'quote', layers: ['base', 'base'] }).code, 'duplicate-layer');
  });
});

describe('5. change a node kind', () => {
  test('changes the kind', () => {
    const next = apply(baseDoc(), { type: 'set-kind', node: 'quote', kind: 'service' });
    assert.strictEqual(nodeById(next, 'quote').kind, 'service');
  });

  test('clears a brand icon when the node stops being a service', () => {
    const next = apply(baseDoc(), { type: 'set-kind', node: 'form', kind: 'manual' });
    assert.strictEqual(nodeById(next, 'form').icon, null);
  });

  test('keeps the icon when the node stays a service', () => {
    const doc = baseDoc();
    doc.nodes[1].kind = 'service';
    const next = apply(doc, { type: 'set-kind', node: 'form', kind: 'service' });
    assert.strictEqual(nodeById(next, 'form').icon, 'typeform');
  });

  test('refuses a kind that is not one of the six', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'set-kind', node: 'form', kind: 'database' }).code, 'unknown-kind');
  });
});

describe('6. sticky notes', () => {
  test('edits content, colour and attachment', () => {
    const next = apply(baseDoc(), {
      type: 'edit-note',
      note: 'n_cap',
      patch: { content: 'Refunds over 1000 need a second signature.', color: 'red' },
    });
    assert.strictEqual(next.notes[0].content, 'Refunds over 1000 need a second signature.');
    assert.strictEqual(next.notes[0].color, 'red');
    assert.deepStrictEqual(next.notes[0].attachTo, ['paid']);
  });

  test('adds a note with a generated id that skips ids already taken', () => {
    const doc = baseDoc();
    doc.notes.push({ id: 'n_user_1', content: 'Taken.', color: 'yellow', layers: ['base'] });
    const next = apply(doc, { type: 'add-note', attachTo: ['quote'], content: 'This step is wrong.', color: 'red', layers: ['base'] });
    const added = next.notes[next.notes.length - 1];
    assert.strictEqual(added.id, 'n_user_2');
    assert.deepStrictEqual(added.attachTo, ['quote']);
  });

  test('deletes a note', () => {
    const next = apply(baseDoc(), { type: 'delete-note', note: 'n_cap' });
    assert.deepStrictEqual(next.notes, []);
  });

  test('refuses content over the cap, an unknown colour and an unknown attachment', () => {
    const long = 'x'.repeat(2001);
    assert.strictEqual(guard(baseDoc(), { type: 'edit-note', note: 'n_cap', patch: { content: long } }).code, 'note-too-long');
    assert.strictEqual(guard(baseDoc(), { type: 'edit-note', note: 'n_cap', patch: { color: 'beige' } }).code, 'unknown-color');
    assert.strictEqual(guard(baseDoc(), { type: 'add-note', attachTo: ['ghost'], content: 'hi', color: 'yellow', layers: ['base'] }).code, 'unknown-attach-target');
  });

  test('refuses a twenty-first note', () => {
    const doc = baseDoc();
    doc.notes = [];
    for (let i = 0; i < 20; i++) doc.notes.push({ id: `n_${i}`, content: 'note', color: 'yellow', layers: ['base'] });
    assert.strictEqual(guard(doc, { type: 'add-note', content: 'one too many', color: 'yellow', layers: ['base'] }).code, 'too-many-notes');
  });
});

describe('7. accept a suggested node', () => {
  test("drops status, rationale and cites, keeps the integration, marks it the user's", () => {
    const next = apply(baseDoc(), { type: 'accept-suggestion', node: 's_xero' });
    const accepted = nodeById(next, 's_xero');
    assert.strictEqual(accepted.status, undefined);
    assert.strictEqual(accepted.rationale, undefined);
    assert.strictEqual(accepted.cites, undefined);
    assert.strictEqual(accepted.integration, 'xero');
    assert.strictEqual(accepted.source, 'user');
    assert.strictEqual(next.edges.length, 6, 'its edges stay');
  });

  test('refuses a node that is not suggested', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'accept-suggestion', node: 'form' }).code, 'not-suggested');
  });
});

describe('8. delete a node, which is also how a suggestion is declined', () => {
  test('removes the node and every edge touching it', () => {
    const next = apply(baseDoc(), { type: 'delete-node', node: 's_xero' });
    assert.strictEqual(nodeById(next, 's_xero'), undefined);
    assert.strictEqual(next.edges.length, 5);
  });

  test('refuses when a suggestion cites the node, and offers to decline it too', () => {
    const refusal = guard(baseDoc(), { type: 'delete-node', node: 'invoice' });
    assert.strictEqual(refusal.code, 'cited-by-suggestion');
    assert.deepStrictEqual(refusal.fix, [{ type: 'delete-node', node: 's_xero' }, { type: 'delete-node', node: 'invoice' }]);
  });

  test('refuses when it would strand another node, and offers to delete that one too', () => {
    const refusal = guard(baseDoc(), { type: 'delete-node', node: 'quote' });
    assert.strictEqual(refusal.code, 'would-strand-node');
    assert.ok(refusal.fix.some(op => op.node === 'q_chaser'));
  });

  test('drops a note that attached only to the deleted node', () => {
    const next = apply(baseDoc(), { type: 'delete-node', node: 's_xero' });
    assert.strictEqual(next.notes.length, 1, 'the note on "paid" is untouched');
    const withNote = baseDoc();
    withNote.notes[0].attachTo = ['s_xero'];
    const after = apply(withNote, { type: 'delete-node', node: 's_xero' });
    assert.deepStrictEqual(after.notes, []);
  });

  test('keeps a note that also names a surviving node', () => {
    const doc = baseDoc();
    doc.notes[0].attachTo = ['s_xero', 'paid'];
    const next = apply(doc, { type: 'delete-node', node: 's_xero' });
    assert.deepStrictEqual(next.notes[0].attachTo, ['paid']);
  });
});

describe('every document an operation produces is valid', () => {
  const ops = [
    { type: 'reattach-edge', index: 4, end: 'from', node: 'form' },
    { type: 'delete-edge', index: 2 },
    { type: 'set-group', node: 'paid', group: 'g_intake' },
    { type: 'set-layers', node: 'quote', layers: ['base'] },
    { type: 'set-kind', node: 'form', kind: 'manual' },
    { type: 'add-note', attachTo: ['quote'], content: 'This step is wrong.', color: 'red', layers: ['base'] },
    { type: 'edit-note', note: 'n_cap', patch: { color: 'red' } },
    { type: 'delete-note', note: 'n_cap' },
    { type: 'accept-suggestion', node: 's_xero' },
    { type: 'delete-node', node: 's_xero' },
  ];

  ops.forEach(op => {
    test(`${op.type} on the fixture passes validateDoc`, () => {
      const next = apply(baseDoc(), op);
      assert.doesNotThrow(() => validateDoc(next));
    });
  });
});

describe('replaying the stack equals applying the operations one by one', () => {
  test('the undo invariant', () => {
    const stack = [
      { type: 'set-kind', node: 'form', kind: 'manual' },
      { type: 'set-group', node: 'paid', group: 'g_intake' },
      { type: 'accept-suggestion', node: 's_xero' },
      { type: 'delete-edge', index: 2 },
    ];
    let stepwise = baseDoc();
    stack.forEach(op => { stepwise = apply(stepwise, op); });
    const replayed = stack.reduce((doc, op) => applyOp(doc, op), baseDoc());
    assert.deepStrictEqual(replayed, stepwise);
  });
});

describe('describeOp reads as a change list', () => {
  const cases = [
    [{ type: 'set-group', node: 'paid', group: 'g_intake' }, 'Moved **Bank transfer** from *Money* to *Intake*.'],
    [{ type: 'set-group', node: 'paid', group: null }, 'Moved **Bank transfer** out of *Money*.'],
    [{ type: 'reattach-edge', index: 4, end: 'from', node: 'form' }, 'Reattached the connection to **Who chases this?**: now from *Enquiry form* (was *Send quote*).'],
    [{ type: 'delete-edge', index: 4 }, 'Deleted the connection *Send quote* to *Who chases this?* ("no reply").'],
    [{ type: 'set-layers', node: 'quote', layers: ['base'] }, 'Changed **Send quote** layers from base, business to base.'],
    [{ type: 'set-kind', node: 'form', kind: 'manual' }, 'Changed **Enquiry form** from `service` to `manual`, and cleared its icon `typeform`.'],
    [{ type: 'accept-suggestion', node: 's_xero' }, 'Accepted the suggested integration **Xero** (`xero`).'],
    [{ type: 'delete-node', node: 's_xero' }, 'Declined the suggested integration **Xero** (`xero`).'],
    [{ type: 'delete-node', node: 'q_chaser' }, 'Deleted **Who chases this?** and its connections.'],
    [{ type: 'delete-note', note: 'n_cap' }, 'Deleted a sticky note on *Bank transfer*.'],
    [{ type: 'edit-note', note: 'n_cap', patch: { color: 'red' } }, 'Edited a sticky note on *Bank transfer*.'],
    [{ type: 'add-note', attachTo: ['quote'], content: 'Wrong.', color: 'red', layers: ['base'] }, 'Added a sticky note on *Send quote*.'],
  ];

  cases.forEach(([op, expected]) => {
    test(op.type, () => {
      assert.strictEqual(describeOp(baseDoc(), op), expected);
    });
  });
});

describe('an unknown operation is refused rather than ignored', () => {
  test('guard names it', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'move-node-to-x-1180' }).code, 'unknown-operation');
  });

  test('applyOp throws rather than returning the document unchanged', () => {
    assert.throws(() => applyOp(baseDoc(), { type: 'move-node-to-x-1180' }), /unknown-operation/);
  });

  test('applyOp throws on a refused operation', () => {
    assert.throws(() => applyOp(baseDoc(), { type: 'delete-edge', index: 4 }), /would-strand-node/);
  });

  test('guard takes an operation with no type at all', () => {
    assert.strictEqual(guard(baseDoc(), null).code, 'unknown-operation');
  });
});
