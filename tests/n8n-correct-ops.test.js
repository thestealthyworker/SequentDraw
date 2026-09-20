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

const { applyOp, guard, describeOp, edgesRemovedBy, trackEdges } = require('../src/n8n/correct-ops');
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

describe('an id that names something on Object.prototype is just an id', () => {
  // validate.js's ID_RE allows "__proto__", "constructor" and "toString".
  // On a plain {} used as an id set, reading one is truthy before anything
  // is stored and writing "__proto__" is swallowed -- which silently broke
  // the orphan arithmetic in both directions.
  function hostileDoc() {
    return {
      title: 'Hostile ids',
      groups: [{ id: 'g', label: 'Group', color: 'blue' }],
      nodes: [
        { id: '__proto__', label: 'Proto', kind: 'service', layers: ['base'], parentId: 'g' },
        { id: 'constructor', label: 'Ctor', kind: 'service', layers: ['base'], parentId: 'g' },
        { id: 'toString', label: 'Str', kind: 'service', layers: ['base'], parentId: 'g' },
      ],
      edges: [
        { from: '__proto__', to: 'constructor', type: 'solid' },
        { from: 'constructor', to: 'toString', type: 'solid' },
      ],
    };
  }

  test('a stranding is detected even when the stranded node is named __proto__', () => {
    const refusal = guard(hostileDoc(), { type: 'delete-edge', index: 0 });
    assert.strictEqual(refusal.code, 'would-strand-node');
    assert.ok(refusal.fix.some(op => op.node === '__proto__'));
  });

  test('a legal deletion is not refused because some other node is named __proto__', () => {
    const doc = hostileDoc();
    doc.nodes.push({ id: 'a', label: 'A', kind: 'service', layers: ['base'] });
    doc.nodes.push({ id: 'b', label: 'B', kind: 'service', layers: ['base'] });
    doc.nodes.push({ id: 'c', label: 'C', kind: 'service', layers: ['base'] });
    doc.edges.push({ from: 'a', to: 'b', type: 'solid' });
    doc.edges.push({ from: 'b', to: 'c', type: 'solid' });
    doc.edges.push({ from: 'a', to: 'c', type: 'solid' });
    assert.strictEqual(guard(doc, { type: 'delete-edge', index: 4 }), null);
  });

  test('deleting a node named __proto__ takes only its own edges', () => {
    const next = applyOp(hostileDoc(), { type: 'delete-node', node: 'toString' });
    assert.deepStrictEqual(next.edges, [{ from: '__proto__', to: 'constructor', type: 'solid' }]);
  });

  test('a generated note id skips one already taken by a hostile id', () => {
    const doc = hostileDoc();
    doc.notes = [{ id: 'n_user_1', content: 'Taken.', color: 'yellow', layers: ['base'] }];
    const next = applyOp(doc, { type: 'add-note', content: 'Mine.', color: 'yellow', layers: ['base'] });
    assert.strictEqual(next.notes[1].id, 'n_user_2');
  });
});

describe('a note patch carries only the four fields a note has', () => {
  test('refuses an unknown key rather than copying it', () => {
    const refusal = guard(baseDoc(), { type: 'edit-note', note: 'n_cap', patch: { color: 'red', sticky: true } });
    assert.strictEqual(refusal.code, 'unknown-note-field');
  });

  test('refuses __proto__ arriving as a real own key from JSON.parse', () => {
    const patch = JSON.parse('{"color":"red","__proto__":{"pwned":true}}');
    const refusal = guard(baseDoc(), { type: 'edit-note', note: 'n_cap', patch });
    assert.strictEqual(refusal.code, 'unknown-note-field');
    assert.throws(() => applyOp(baseDoc(), { type: 'edit-note', note: 'n_cap', patch }), /unknown-note-field/);
  });

  test('does not leave the edited note with an attacker-chosen prototype', () => {
    const patch = JSON.parse('{"color":"red","__proto__":{"pwned":true}}');
    let edited = null;
    try {
      edited = applyOp(baseDoc(), { type: 'edit-note', note: 'n_cap', patch });
    } catch (e) {
      edited = null;
    }
    assert.strictEqual(edited, null);
  });

  test('refuses content present but undefined, rather than blanking the note', () => {
    // JSON cannot carry `undefined`, but a JS caller can: `{ content: x }`
    // where x is undefined. Object.keys still lists the key, so copying the
    // patch would have overwritten required content with undefined.
    const refusal = guard(baseDoc(), { type: 'edit-note', note: 'n_cap', patch: { content: undefined } });
    assert.strictEqual(refusal.code, 'empty-note');
  });

  test('an empty patch changes nothing', () => {
    const doc = baseDoc();
    const next = apply(doc, { type: 'edit-note', note: 'n_cap', patch: {} });
    assert.deepStrictEqual(next.notes, doc.notes);
  });
});

describe('two suggestions citing the same node', () => {
  function twoSuggestions() {
    const doc = baseDoc();
    doc.nodes.push({
      id: 's_stripe',
      label: 'Stripe',
      kind: 'service',
      status: 'suggested',
      integration: 'stripe',
      rationale: 'Takes the payment on the invoice instead of waiting for a transfer.',
      cites: ['invoice'],
      layers: ['base'],
    });
    doc.edges.push({ from: 'invoice', to: 's_stripe', type: 'dashed' });
    return doc;
  }

  test('both are named in the refusal, and the deletion comes last in the fix', () => {
    const refusal = guard(twoSuggestions(), { type: 'delete-node', node: 'invoice' });
    assert.strictEqual(refusal.code, 'cited-by-suggestion');
    assert.deepStrictEqual(refusal.fix, [
      { type: 'delete-node', node: 's_xero' },
      { type: 'delete-node', node: 's_stripe' },
      { type: 'delete-node', node: 'invoice' },
    ]);
    assert.match(refusal.message, /Xero/);
    assert.match(refusal.message, /Stripe/);
  });

  test('applying the offered fix in order leaves a valid document', () => {
    let doc = twoSuggestions();
    guard(doc, { type: 'delete-node', node: 'invoice' }).fix.forEach(op => { doc = applyOp(doc, op); });
    assert.doesNotThrow(() => validateDoc(doc));
    assert.strictEqual(doc.nodes.filter(n => n.status === 'suggested').length, 0);
  });
});

describe('refusals that name something no longer in the map', () => {
  test('delete-edge past the end', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'delete-edge', index: 42 }).code, 'unknown-edge');
  });

  test('edit-note and delete-note on a note that is gone', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'edit-note', note: 'n_gone', patch: {} }).code, 'unknown-note');
    assert.strictEqual(guard(baseDoc(), { type: 'delete-note', note: 'n_gone' }).code, 'unknown-note');
  });

  test('set-group, set-layers, set-kind, accept and delete on a node that is gone', () => {
    ['set-group', 'set-layers', 'set-kind', 'accept-suggestion', 'delete-node'].forEach(type => {
      const op = { type, node: 'n_gone', group: null, layers: ['base'], kind: 'service' };
      assert.strictEqual(guard(baseDoc(), op).code, 'unknown-node', type);
    });
  });

  test('a note with no text, and an attachTo that is not a list', () => {
    assert.strictEqual(guard(baseDoc(), { type: 'add-note', content: '   ', color: 'yellow', layers: ['base'] }).code, 'empty-note');
    assert.strictEqual(guard(baseDoc(), { type: 'add-note', content: 'hi', attachTo: 'quote' }).code, 'invalid-attach');
  });
});

describe('an edge keeps its identity while the stack grows', () => {
  // The rendered SVG carries each edge's ORIGINAL index and never changes,
  // because nothing re-renders while corrections are being made. An
  // operation, though, addresses an edge by where it sits in the document
  // as the stack stands. After one deletion the two diverge, and an
  // operation built from the stale number silently hits a different edge:
  // still in bounds, so no refusal, and a change list that confidently
  // describes the wrong connection. Found in review of the viewer.
  function track(doc) {
    return doc.edges.map((_, i) => i);
  }

  function replay(doc, ops) {
    let current = doc;
    let positions = track(doc);
    ops.forEach(op => {
      positions = trackEdges(current, op, positions);
      current = applyOp(current, op);
    });
    return { doc: current, positions };
  }

  test('a deletion shifts every later edge down by one', () => {
    const { positions } = replay(ringDoc(), [{ type: 'delete-edge', index: 2 }]);
    assert.deepStrictEqual(positions, [0, 1, -1, 2, 3, 4]);
  });

  // A ring of six steps, so a deletion never strands anything and the
  // indices stay easy to reason about.
  function ringDoc() {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    return {
      title: 'Ring',
      nodes: ids.map(id => ({ id, label: id.toUpperCase(), kind: 'service', layers: ['base'] })),
      edges: ids.map((id, i) => ({ from: id, to: ids[(i + 1) % ids.length], type: 'solid' })),
    };
  }

  test('the stale index would have hit the wrong edge; the tracked one does not', () => {
    const doc = ringDoc();
    const renderedIndex = 4; // e -> f, as the SVG numbered it
    assert.deepStrictEqual(
      { from: doc.edges[renderedIndex].from, to: doc.edges[renderedIndex].to },
      { from: 'e', to: 'f' }
    );

    const { doc: after, positions } = replay(doc, [{ type: 'delete-edge', index: 1 }]);

    // The stale number is still in range, which is exactly why the bug was
    // silent: it addresses a different connection.
    assert.deepStrictEqual(
      { from: after.edges[renderedIndex].from, to: after.edges[renderedIndex].to },
      { from: 'f', to: 'a' },
      'the rendered index now points at the wrong edge'
    );

    // The tracked number still addresses the edge the reader clicked.
    const live = positions[renderedIndex];
    assert.strictEqual(live, 3);
    assert.deepStrictEqual(
      { from: after.edges[live].from, to: after.edges[live].to },
      { from: 'e', to: 'f' }
    );
  });

  test('deleting a node retires every edge it touched', () => {
    const doc = baseDoc();
    const { positions } = replay(doc, [{ type: 'delete-node', node: 's_xero' }]);
    assert.strictEqual(positions[5], -1, 'invoice -> Xero is gone');
    assert.deepStrictEqual(positions.slice(0, 5), [0, 1, 2, 3, 4], 'nothing else moved');
  });

  test('a retired edge stays retired through later operations', () => {
    const doc = ringDoc();
    // b -> c, then the edge the reader still sees as index 4 (e -> f),
    // which by then sits at index 3.
    const { positions } = replay(doc, [
      { type: 'delete-edge', index: 1 },
      { type: 'delete-edge', index: 3 },
    ]);
    assert.strictEqual(positions[1], -1, 'b -> c is gone');
    assert.strictEqual(positions[4], -1, 'e -> f is gone');
    assert.deepStrictEqual(positions, [0, -1, 1, 2, -1, 3]);
  });

  test('a reattachment moves no index', () => {
    const { positions } = replay(ringDoc(), [{ type: 'reattach-edge', index: 4, end: 'to', node: 'c' }]);
    assert.deepStrictEqual(positions, [0, 1, 2, 3, 4, 5]);
  });

  test('edgesRemovedBy reports exactly what an operation removes', () => {
    const doc = baseDoc();
    assert.deepStrictEqual(edgesRemovedBy(doc, { type: 'delete-edge', index: 3 }), [3]);
    assert.deepStrictEqual(edgesRemovedBy(doc, { type: 'delete-node', node: 'invoice' }), [2, 3, 5]);
    assert.deepStrictEqual(edgesRemovedBy(doc, { type: 'set-kind', node: 'form', kind: 'manual' }), []);
    assert.deepStrictEqual(edgesRemovedBy(doc, { type: 'delete-edge', index: 99 }), [], 'an impossible deletion removes nothing');
    assert.deepStrictEqual(edgesRemovedBy(doc, null), []);
  });

  test('the tracked index survives a long mixed sequence, checked edge by edge', () => {
    const doc = ringDoc();
    const ops = [
      { type: 'set-kind', node: 'a', kind: 'manual' },
      { type: 'delete-edge', index: 0 },
      { type: 'set-layers', node: 'c', layers: ['base', 'business'] },
      { type: 'delete-edge', index: 2 },
      { type: 'reattach-edge', index: 0, end: 'to', node: 'e' },
    ];
    const { doc: after, positions } = replay(doc, ops);
    doc.edges.forEach((original, renderedIndex) => {
      const live = positions[renderedIndex];
      if (live < 0) return;
      const now = after.edges[live];
      const reattached = renderedIndex === 1; // b -> c, whose "to" was moved
      assert.deepStrictEqual(
        { from: now.from, to: reattached ? original.to : now.to },
        { from: original.from, to: original.to },
        `rendered edge ${renderedIndex} must still resolve to the edge it was`
      );
    });
    assert.deepStrictEqual(positions.filter(i => i < 0).length, 2, 'two edges were deleted');
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
