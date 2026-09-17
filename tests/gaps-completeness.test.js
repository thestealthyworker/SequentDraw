// checkCompleteness(doc): the six completeness rules of
// docs/design/business-map.md section 2, each covered in isolation against
// small, hand-built documents -- one fixture per rule that fires, one that
// does not, and one where an open node stands in the gap and the rule stays
// quiet. Plus the measurement the design doc pins on the reference fixture:
// exactly four gaps on examples/medusa-return-flow.json, and only those four.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { checkCompleteness, buildOpenDocument } = require('../src/gaps/completeness');
const { validateDoc } = require('../src/n8n/validate');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');

function codesOf(result) {
  return result.errors.map(e => e.code);
}

// Every fixture needs a node carrying "business" or the gate closes and no
// rule runs at all (the owner's decision recorded at
// docs/design/business-map.md:181-183), and one owned unhappy path on the
// "edge" layer so rule 6a (no unhappy path at all) stays out of the way of
// the rule under test. Indexes: frame nodes are /nodes/0..2 and frame edges
// /edges/0..1, so a fixture's own first node is /nodes/3.
const FRAME_NODES = [
  { id: 'anchor', label: 'Anchor', kind: 'human', layers: ['business'] },
  { id: 'late', label: 'Nobody replies', kind: 'logic', layers: ['edge'] },
  { id: 'ops', label: 'Ops lead', kind: 'human', layers: ['edge', 'business'] },
];
const FRAME_EDGES = [
  { from: 'anchor', to: 'late', type: 'solid' },
  { from: 'late', to: 'ops', type: 'solid' },
];

function doc(nodes, edges = [], extra = {}) {
  return { title: 'map', nodes: [...FRAME_NODES, ...nodes], edges: [...FRAME_EDGES, ...edges], ...extra };
}

test('the frame fixture itself is complete', () => {
  assert.deepStrictEqual(checkCompleteness(doc([])).errors, []);
});

describe('the business-layer gate', () => {
  test('a base-only map (what git-map produces) yields no findings at all', () => {
    // Load-bearing: rule 2 would otherwise fire on the entry service of
    // practically every scanned repository, and
    // evals/git-map-output-compose-app grades that `check … --evidence`
    // prints "ok" (skills/git-map/SKILL.md:115-122).
    const map = {
      title: 'compose-app map',
      nodes: [
        { id: 'web', label: 'Web', kind: 'service', layers: ['base'] },
        { id: 'api', label: 'Api', kind: 'service', layers: ['base'] },
        { id: 'db', label: 'Postgres', kind: 'service', layers: ['base'] },
      ],
      edges: [
        { from: 'web', to: 'api', type: 'solid' },
        { from: 'api', to: 'db', type: 'solid' },
      ],
    };
    const result = checkCompleteness(map);
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.additions.nodes, []);
    assert.deepStrictEqual(result.additions.notes, []);
  });

  test('a map with no layers field anywhere yields no findings (layers default to base)', () => {
    const map = {
      title: 'map',
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'solid' }],
    };
    assert.deepStrictEqual(checkCompleteness(map).errors, []);
  });

  test('one node carrying "business" opens the gate', () => {
    const map = doc([{ id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'] }], [{ from: 'anchor', to: 'inv', type: 'solid' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), ['artifact-no-recipient']);
  });
});

describe('rule 1: artifact-no-recipient', () => {
  const artifact = { id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'] };

  test('an artifact with no outgoing edge fires', () => {
    const result = checkCompleteness(doc([artifact], [{ from: 'anchor', to: 'inv', type: 'solid' }]));
    assert.deepStrictEqual(codesOf(result), ['artifact-no-recipient']);
    assert.strictEqual(result.errors[0].path, '/nodes/3');
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'external');
    assert.strictEqual(q.label, 'Who receives this?');
    assert.strictEqual(q.id, 'q_recipient_inv');
    assert.deepStrictEqual(result.additions.edges, [{ from: 'inv', to: 'q_recipient_inv', type: 'solid' }]);
  });

  test('an artifact consumed by a system does not fire', () => {
    // Medusa uses `artifact` for data models and migrations; the stricter
    // "recipient must be human or external" reading fires on six of them
    // (docs/design/business-map.md:213-216).
    const map = doc(
      [artifact, { id: 'svc', label: 'Service', kind: 'service', layers: ['base'] }],
      [
        { from: 'anchor', to: 'inv', type: 'solid' },
        { from: 'inv', to: 'svc', type: 'solid' },
        { from: 'svc', to: 'anchor', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an open artifact is never a subject', () => {
    const map = doc([{ ...artifact, status: 'open', prompt: 'which invoice?' }], [{ from: 'anchor', to: 'inv', type: 'solid' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an open node standing in the gap satisfies the rule', () => {
    const map = doc(
      [artifact, { id: 'q_recipient_inv', label: 'Who receives this?', kind: 'external', layers: ['business'], status: 'open', prompt: 'who?' }],
      [
        { from: 'anchor', to: 'inv', type: 'solid' },
        { from: 'inv', to: 'q_recipient_inv', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });
});

describe('rule 2: input-no-source-actor', () => {
  test('a base-layer service with in-degree 0 fires', () => {
    const map = doc(
      [
        { id: 'intake', label: 'Intake form', kind: 'service', layers: ['base'] },
        { id: 'next', label: 'Next', kind: 'manual', layers: ['base', 'business'] },
      ],
      [
        { from: 'intake', to: 'next', type: 'solid' },
        { from: 'next', to: 'anchor', type: 'solid' },
      ]
    );
    const result = checkCompleteness(map);
    assert.deepStrictEqual(codesOf(result), ['input-no-source-actor']);
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'external');
    assert.strictEqual(q.label, 'Who starts this?');
    assert.deepStrictEqual(result.additions.edges, [{ from: 'q_source_intake', to: 'intake', type: 'solid' }]);
  });

  test('a human or external entry point does not fire', () => {
    // The frame's own anchor is a human with in-degree 0.
    const map = doc(
      [{ id: 'party', label: 'Customer', kind: 'external', layers: ['business'] }],
      [{ from: 'party', to: 'anchor', type: 'solid' }]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an edge-only or build-only node with in-degree 0 does not fire', () => {
    // A failure branch or a CI job is not an entry point.
    const map = doc(
      [
        { id: 'guest', label: 'Guest path', kind: 'logic', layers: ['edge'] },
        { id: 'owner', label: 'Support', kind: 'human', layers: ['edge', 'business'] },
        { id: 'ci', label: 'CI', kind: 'service', layers: ['build'] },
        { id: 'tests', label: 'Tests', kind: 'service', layers: ['build'] },
      ],
      [
        { from: 'guest', to: 'owner', type: 'solid' },
        { from: 'ci', to: 'tests', type: 'solid' },
        { from: 'tests', to: 'ci', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });
});

describe('rule 3: handoff-undrawn', () => {
  const systems = [
    { id: 'crm', label: 'CRM', kind: 'service', layers: ['base'] },
    { id: 'books', label: 'Bookkeeping', kind: 'service', layers: ['base'] },
  ];
  // /edges/2 and /edges/3; the edge under test is always /edges/4.
  const wiring = [
    { from: 'anchor', to: 'crm', type: 'solid' },
    { from: 'books', to: 'anchor', type: 'solid' },
  ];

  test('a user-sourced service -> service edge with no description fires and inserts', () => {
    const map = doc(systems, [...wiring, { from: 'crm', to: 'books', type: 'solid', source: 'user' }]);
    const result = checkCompleteness(map);
    assert.deepStrictEqual(codesOf(result), ['handoff-undrawn']);
    assert.strictEqual(result.errors[0].path, '/edges/4');
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'manual');
    assert.strictEqual(q.label, 'How does this move?');
    assert.strictEqual(q.id, 'q_handoff_crm_books');
    // Inserts from -> q -> to: the original edge is re-pointed at the
    // question and the second half repeats its type.
    assert.deepStrictEqual(result.additions.edgeEdits, [{ index: 4, to: 'q_handoff_crm_books' }]);
    assert.deepStrictEqual(result.additions.edges, [{ from: 'q_handoff_crm_books', to: 'books', type: 'solid' }]);
  });

  test('a described edge, a scan-sourced edge and an unsourced edge do not fire', () => {
    const described = doc(systems, [...wiring, { from: 'crm', to: 'books', type: 'solid', source: 'user', description: 'nightly API sync' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(described)), []);
    const scanned = doc(systems, [...wiring, { from: 'crm', to: 'books', type: 'solid', source: 'scan' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(scanned)), []);
    const unsourced = doc(systems, [...wiring, { from: 'crm', to: 'books', type: 'solid' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(unsourced)), []);
  });

  test('a handoff to a non-system does not fire', () => {
    const map = doc(
      [systems[0], { id: 'clerk', label: 'Clerk', kind: 'human', layers: ['business'] }],
      [
        { from: 'anchor', to: 'crm', type: 'solid' },
        { from: 'clerk', to: 'anchor', type: 'solid' },
        { from: 'crm', to: 'clerk', type: 'solid', source: 'user' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an open endpoint means the edge is not a subject', () => {
    const map = doc(
      [systems[0], { ...systems[1], status: 'open', prompt: 'which system?' }],
      [...wiring, { from: 'crm', to: 'books', type: 'solid', source: 'user' }]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('the replaced edge keeps its type and condition on the correct side', () => {
    const map = doc(systems, [...wiring, { from: 'crm', to: 'books', type: 'dashed', condition: 'on approval', source: 'user' }]);
    const result = checkCompleteness(map);
    const copy = buildOpenDocument(map, result.additions);
    const [first] = copy.edges.filter(e => e.from === 'crm' && e.to.startsWith('q_'));
    const [second] = copy.edges.filter(e => e.from.startsWith('q_') && e.to === 'books');
    // The condition stays on the half that still leaves the original node,
    // and both halves keep the original type.
    assert.strictEqual(first.type, 'dashed');
    assert.strictEqual(first.condition, 'on approval');
    assert.strictEqual(first.source, 'user');
    assert.strictEqual(second.type, 'dashed');
    assert.strictEqual(second.condition, undefined);
    assert.strictEqual(copy.edges.filter(e => e.from === 'crm' && e.to === 'books').length, 0);
    assert.deepStrictEqual(checkCompleteness(copy).errors, []);
  });
});

describe('rule 4: decision-no-decider', () => {
  const branches = kind => [
    { id: 'gate', label: 'Triage', kind, layers: ['base', 'business'] },
    { id: 'yes', label: 'Accepted', kind: 'manual', layers: ['base', 'business'] },
    { id: 'no', label: 'Declined', kind: 'manual', layers: ['base', 'business'] },
  ];
  // /edges/2 .. /edges/6; the conditional pair is /edges/3 and /edges/4.
  const wiring = [
    { from: 'anchor', to: 'gate', type: 'solid' },
    { from: 'gate', to: 'yes', type: 'dashed', condition: 'accepted' },
    { from: 'gate', to: 'no', type: 'dashed', condition: 'declined' },
    { from: 'yes', to: 'anchor', type: 'solid' },
    { from: 'no', to: 'anchor', type: 'solid' },
  ];

  test('a non-decider node with two conditional outgoing edges fires and rewires them', () => {
    const map = doc(branches('service'), wiring);
    const result = checkCompleteness(map);
    assert.deepStrictEqual(codesOf(result), ['decision-no-decider']);
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'logic');
    assert.strictEqual(q.label, 'Who decides?');
    assert.strictEqual(q.id, 'q_decider_gate');
    assert.match(q.prompt, /branches on accepted, declined/);
    assert.deepStrictEqual(result.additions.edges, [{ from: 'gate', to: 'q_decider_gate', type: 'solid' }]);
    assert.deepStrictEqual(result.additions.edgeEdits, [
      { index: 3, from: 'q_decider_gate' },
      { index: 4, from: 'q_decider_gate' },
    ]);

    const copy = buildOpenDocument(map, result.additions);
    const moved = copy.edges.filter(e => e.from === 'q_decider_gate');
    assert.deepStrictEqual(
      moved.map(e => [e.to, e.type, e.condition]),
      [
        ['yes', 'dashed', 'accepted'],
        ['no', 'dashed', 'declined'],
      ]
    );
    assert.deepStrictEqual(checkCompleteness(copy).errors, []);
  });

  test('a human or logic decider does not fire', () => {
    assert.deepStrictEqual(codesOf(checkCompleteness(doc(branches('logic'), wiring))), []);
    assert.deepStrictEqual(codesOf(checkCompleteness(doc(branches('human'), wiring))), []);
  });

  test('a single conditional edge is not a split', () => {
    const map = doc(branches('service'), [
      ...wiring.filter(e => e.condition !== 'declined'),
      { from: 'gate', to: 'no', type: 'solid' },
    ]);
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });
});

describe('rule 5: flow-dead-end', () => {
  test('a business-layer service sink fires', () => {
    const map = doc([{ id: 'crm', label: 'CRM record', kind: 'service', layers: ['base', 'business'] }], [{ from: 'anchor', to: 'crm', type: 'solid' }]);
    const result = checkCompleteness(map);
    assert.deepStrictEqual(codesOf(result), ['flow-dead-end']);
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'artifact');
    assert.strictEqual(q.label, 'What comes out of this?');
    assert.strictEqual(q.id, 'q_outcome_crm');
  });

  test('a sink that is a party or an artifact does not fire', () => {
    // An artifact sink is rule 1's subject, never rule 5's: the lifecycle
    // ending in a document is the right ending.
    for (const kind of ['human', 'external', 'artifact']) {
      const map = doc([{ id: 'end', label: 'End', kind, layers: ['business'] }], [{ from: 'anchor', to: 'end', type: 'solid' }]);
      assert.strictEqual(codesOf(checkCompleteness(map)).includes('flow-dead-end'), false, kind);
    }
  });

  test('a base-only sink does not fire (a technical map ends where it ends)', () => {
    const map = doc([{ id: 'pg', label: 'Postgres', kind: 'service', layers: ['base'] }], [{ from: 'anchor', to: 'pg', type: 'solid' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an open node standing in the gap satisfies the rule', () => {
    const map = doc(
      [
        { id: 'crm', label: 'CRM record', kind: 'service', layers: ['base', 'business'] },
        { id: 'q_outcome_crm', label: 'What comes out of this?', kind: 'artifact', layers: ['business'], status: 'open', prompt: 'what?' },
      ],
      [
        { from: 'anchor', to: 'crm', type: 'solid' },
        { from: 'crm', to: 'q_outcome_crm', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });
});

describe('rule 6: unhappy-path-no-owner', () => {
  test('an edge-layer sink fires', () => {
    const map = doc([{ id: 'disputed', label: 'Customer disputes', kind: 'logic', layers: ['edge'] }], [{ from: 'anchor', to: 'disputed', type: 'solid' }]);
    const result = checkCompleteness(map);
    assert.deepStrictEqual(codesOf(result), ['unhappy-path-no-owner']);
    const [q] = result.additions.nodes;
    assert.strictEqual(q.kind, 'human');
    assert.strictEqual(q.label, 'Who handles this?');
    assert.deepStrictEqual(q.layers, ['edge']);
    assert.strictEqual(q.id, 'q_owner_disputed');
  });

  test('an unhappy path with a named owner does not fire', () => {
    const map = doc(
      [
        { id: 'disputed', label: 'Customer disputes', kind: 'logic', layers: ['edge'] },
        { id: 'legal', label: 'Legal', kind: 'human', layers: ['edge', 'business'] },
      ],
      [
        { from: 'anchor', to: 'disputed', type: 'solid' },
        { from: 'disputed', to: 'legal', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an open owner standing in the gap satisfies the rule', () => {
    const map = doc(
      [
        { id: 'disputed', label: 'Customer disputes', kind: 'logic', layers: ['edge'] },
        { id: 'q_owner_disputed', label: 'Who handles this?', kind: 'human', layers: ['edge'], status: 'open', prompt: 'who?' },
      ],
      [
        { from: 'anchor', to: 'disputed', type: 'solid' },
        { from: 'disputed', to: 'q_owner_disputed', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });
});

describe('rule 6a: unhappy-paths-missing', () => {
  // These fixtures deliberately skip the shared frame: the rule is about a
  // map with no "edge" layer at all.
  const happyOnly = {
    title: 'map',
    nodes: [
      { id: 'anchor', label: 'Anchor', kind: 'human', layers: ['business'] },
      { id: 'step', label: 'Step', kind: 'manual', layers: ['base', 'business'] },
    ],
    edges: [
      { from: 'anchor', to: 'step', type: 'solid' },
      { from: 'step', to: 'anchor', type: 'solid' },
    ],
  };

  test('a business map with no edge-layer node gets a map-level gold note', () => {
    const result = checkCompleteness(happyOnly);
    assert.deepStrictEqual(codesOf(result), ['unhappy-paths-missing']);
    assert.strictEqual(result.errors[0].path, '/');
    assert.deepStrictEqual(result.additions.nodes, []); // there is no node to hang it on
    const [note] = result.additions.notes;
    assert.strictEqual(note.color, 'gold');
    assert.deepStrictEqual(note.layers, ['base']);
    assert.strictEqual(note.attachTo, undefined); // map-level
    assert.match(note.content, /^Consider: /);
  });

  test('the note is added to the copy, which then validates and re-checks clean', () => {
    const result = checkCompleteness(happyOnly);
    const copy = buildOpenDocument(happyOnly, result.additions);
    assert.strictEqual(copy.notes.length, 1);
    assert.doesNotThrow(() => validateDoc(copy));
    // Rule 6a still fires on the copy: a note is not an edge-layer node, and
    // only the user can say what goes wrong. It is the one rule --emit-open
    // does not silence, so the flag stays honest about it.
    assert.deepStrictEqual(codesOf(checkCompleteness(copy)), ['unhappy-paths-missing']);
  });

  test('any edge-layer node silences it', () => {
    assert.deepStrictEqual(codesOf(checkCompleteness(doc([]))), []);
  });
});

// A suggestion never changes what the map says about the real system
// (docs/design/suggestion-agent.md section 1): a `suggested` node, and every
// edge touching one, is invisible to completeness -- never a subject, never
// satisfying a rule. Unlike an `open` node, which satisfies rules on purpose.
describe('suggested nodes are ignored', () => {
  const suggested = (id, label, kind, layers) => ({ id, label, kind, layers, status: 'suggested', rationale: 'Commonly used here.', source: 'model' });

  test('a suggested node receiving an artifact does not hide artifact-no-recipient', () => {
    const map = doc(
      [{ id: 'inv', label: 'Job sheet', kind: 'artifact', layers: ['business'] }, suggested('email', 'Email tool', 'service', ['business'])],
      [
        { from: 'anchor', to: 'inv', type: 'solid' },
        { from: 'inv', to: 'email', type: 'solid' },
      ]
    );
    const result = checkCompleteness(map);
    assert.deepStrictEqual(result.errors.map(e => [e.path, e.code]), [['/nodes/3', 'artifact-no-recipient']]);
  });

  test('a suggested business node with no outgoing edge does not trigger flow-dead-end', () => {
    const map = doc(
      [{ id: 'step', label: 'Book job', kind: 'manual', layers: ['business'] }, suggested('sheets', 'Google Sheets', 'service', ['business'])],
      [
        { from: 'anchor', to: 'step', type: 'solid' },
        { from: 'step', to: 'anchor', type: 'solid' },
        { from: 'step', to: 'sheets', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('a suggested node with no incoming edge does not trigger input-no-source-actor', () => {
    const map = doc([suggested('form', 'Web form', 'service', ['base'])], [{ from: 'form', to: 'anchor', type: 'solid' }]);
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('user-sourced edges through a suggested service do not trigger handoff-undrawn', () => {
    const map = doc(
      [
        { id: 'crm', label: 'CRM', kind: 'service', layers: ['base'] },
        { id: 'billing', label: 'Billing', kind: 'service', layers: ['base'] },
        suggested('zap', 'Zapier', 'service', ['base']),
      ],
      [
        { from: 'anchor', to: 'crm', type: 'solid' },
        { from: 'billing', to: 'anchor', type: 'solid' },
        { from: 'crm', to: 'zap', type: 'solid', source: 'user' },
        { from: 'zap', to: 'billing', type: 'solid', source: 'user' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  test('an edge from a suggested node does not satisfy input-no-source-actor', () => {
    const map = doc(
      [suggested('portal', 'Customer portal', 'external', ['base']), { id: 'intake', label: 'Intake form', kind: 'service', layers: ['base'] }],
      [
        { from: 'portal', to: 'intake', type: 'solid' },
        { from: 'intake', to: 'anchor', type: 'solid' },
      ]
    );
    assert.deepStrictEqual(checkCompleteness(map).errors.map(e => [e.path, e.code]), [['/nodes/4', 'input-no-source-actor']]);
  });

  test('conditional edges to suggested nodes do not make a decision', () => {
    const map = doc(
      [
        { id: 'svc', label: 'Router', kind: 'service', layers: ['base'] },
        suggested('a', 'Tool A', 'service', ['base']),
        suggested('b', 'Tool B', 'service', ['base']),
      ],
      [
        { from: 'anchor', to: 'svc', type: 'solid' },
        { from: 'svc', to: 'anchor', type: 'solid' },
        { from: 'svc', to: 'a', type: 'dashed', condition: 'small' },
        { from: 'svc', to: 'b', type: 'dashed', condition: 'large' },
      ]
    );
    assert.deepStrictEqual(codesOf(checkCompleteness(map)), []);
  });

  describe('rule 6a', () => {
    const happyOnly = extra => ({
      title: 'map',
      nodes: [
        { id: 'anchor', label: 'Customer', kind: 'human', layers: ['business'] },
        { id: 'step', label: 'Book job', kind: 'manual', layers: ['business'] },
        suggested('retry', 'Auto-retry', 'service', ['edge']),
      ],
      edges: [
        { from: 'anchor', to: 'step', type: 'solid' },
        { from: 'step', to: 'anchor', type: 'solid' },
        { from: 'step', to: 'retry', type: 'dashed' },
        ...extra,
      ],
    });

    test('a suggested node on the edge layer does not silence unhappy-paths-missing', () => {
      assert.deepStrictEqual(codesOf(checkCompleteness(happyOnly([{ from: 'retry', to: 'anchor', type: 'solid' }]))), ['unhappy-paths-missing']);
    });

    test('a suggested edge-layer node with no outgoing edge is not an unowned unhappy path', () => {
      assert.deepStrictEqual(codesOf(checkCompleteness(happyOnly([]))), ['unhappy-paths-missing']);
    });
  });

  test('a suggested business node does not open the business-layer gate on a base-only map', () => {
    const map = {
      title: 'compose-app map',
      nodes: [
        { id: 'web', label: 'Web', kind: 'service', layers: ['base'] },
        { id: 'api', label: 'Api', kind: 'service', layers: ['base'] },
        suggested('stripe', 'Stripe', 'external', ['business']),
      ],
      edges: [
        { from: 'web', to: 'api', type: 'solid' },
        { from: 'api', to: 'stripe', type: 'solid' },
      ],
    };
    assert.deepStrictEqual(checkCompleteness(map).errors, []);
  });

  test('--emit-open emits no open node about a suggested node, and keeps the suggestion untouched', () => {
    const email = suggested('email', 'Email tool', 'service', ['business']);
    const map = doc(
      [{ id: 'inv', label: 'Job sheet', kind: 'artifact', layers: ['business'] }, email],
      [
        { from: 'anchor', to: 'inv', type: 'solid' },
        { from: 'inv', to: 'email', type: 'solid' },
      ]
    );
    const result = checkCompleteness(map);
    assert.deepStrictEqual(result.additions.nodes.map(n => n.id), ['q_recipient_inv']);
    const mentionsEmail = JSON.stringify(result.additions).includes('email') || JSON.stringify(result.additions).includes('Email tool');
    assert.strictEqual(mentionsEmail, false);

    const copy = buildOpenDocument(map, result.additions);
    assert.doesNotThrow(() => validateDoc(copy));
    assert.deepStrictEqual(copy.nodes.find(n => n.id === 'email'), email);
    assert.deepStrictEqual(checkCompleteness(copy).errors, []);
  });
});

describe('emitted nodes', () => {
  test('carry no "source": the enum has no value for an engine-emitted question', () => {
    const map = doc([{ id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'], source: 'user' }], [{ from: 'anchor', to: 'inv', type: 'solid' }]);
    const [q] = checkCompleteness(map).additions.nodes;
    assert.strictEqual('source' in q, false);
    assert.strictEqual(q.status, 'open');
    assert.ok(q.prompt.length > 0 && q.prompt.length < 500);
  });

  test("copy the subject's layers and parentId", () => {
    const map = {
      title: 'map',
      groups: [{ id: 'g_money', label: 'Money' }],
      nodes: [...FRAME_NODES, { id: 'inv', label: 'Invoice', kind: 'artifact', parentId: 'g_money', layers: ['business', 'base'] }],
      edges: [...FRAME_EDGES, { from: 'anchor', to: 'inv', type: 'solid' }],
    };
    const [q] = checkCompleteness(map).additions.nodes;
    assert.deepStrictEqual(q.layers, ['business', 'base']);
    assert.strictEqual(q.parentId, 'g_money');
  });

  test('a long prompt is cut at the 500-character validator limit', () => {
    const map = doc([{ id: 'inv', label: 'x'.repeat(80), kind: 'artifact', layers: ['business'] }], [{ from: 'anchor', to: 'inv', type: 'solid' }]);
    const [q] = checkCompleteness(map).additions.nodes;
    assert.ok(q.prompt.length <= 500);
    assert.ok(q.label.length <= 80);
  });

  test('an id colliding with an existing id gets a numeric suffix, and every id is <= 64 chars', () => {
    const longId = `inv_${'x'.repeat(70)}`.slice(0, 64);
    const map = doc(
      [
        { id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'] },
        { id: 'q_recipient_inv', label: 'Taken', kind: 'human', layers: ['business'] },
        { id: longId, label: 'Long', kind: 'artifact', layers: ['business'] },
      ],
      [
        { from: 'anchor', to: 'inv', type: 'solid' },
        { from: 'anchor', to: 'q_recipient_inv', type: 'solid' },
        { from: 'anchor', to: longId, type: 'solid' },
      ]
    );
    const ids = checkCompleteness(map).additions.nodes.map(n => n.id);
    assert.strictEqual(ids[0], 'q_recipient_inv_2');
    assert.strictEqual(ids.length, 2);
    ids.forEach(id => {
      assert.ok(id.length <= 64, id);
      assert.match(id, /^[A-Za-z0-9_.:-]{1,64}$/);
      assert.match(id, /^q_/);
    });
  });
});

describe('bounds and hostile input', () => {
  test('a document over the node cap is not walked at all', () => {
    const nodes = Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, label: 'N', kind: 'artifact', layers: ['business'] }));
    assert.deepStrictEqual(checkCompleteness({ title: 'x', nodes, edges: [] }).errors, []);
  });

  test('a document over the edge cap is not walked at all', () => {
    const edges = Array.from({ length: 501 }, () => ({ from: 'anchor', to: 'anchor', type: 'solid' }));
    const map = doc([{ id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'] }], edges);
    assert.deepStrictEqual(checkCompleteness(map).errors, []);
  });

  test('the report stops at 100 findings', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: 'N', kind: 'artifact', layers: ['business'] }));
    const result = checkCompleteness({ title: 'x', nodes, edges: [] });
    assert.strictEqual(result.errors.length, 100);
    assert.ok(result.additions.nodes.length <= 100);
  });

  test('a malformed document never throws', () => {
    const malformed = [
      null,
      undefined,
      42,
      'x',
      [],
      {},
      { nodes: 'no' },
      { nodes: [null, 1, { id: 5 }], edges: [null, { from: 1 }] },
      { nodes: [{ layers: ['business'] }, null], edges: [null] },
      { nodes: [{ id: '../../etc', label: 'x', kind: 'artifact', layers: ['business'] }], edges: [] },
    ];
    malformed.forEach(bad => assert.doesNotThrow(() => checkCompleteness(bad), String(bad)));
  });

  test('a subject id with characters an id may not contain still produces a valid question id', () => {
    const map = { title: 'x', nodes: [{ id: 'a/b c', label: 'Odd', kind: 'artifact', layers: ['business'] }], edges: [] };
    const [q] = checkCompleteness(map).additions.nodes;
    assert.match(q.id, /^[A-Za-z0-9_.:-]{1,64}$/);
  });
});

describe('buildOpenDocument', () => {
  test('leaves the input document and its nodes untouched', () => {
    const map = doc([{ id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'] }], [{ from: 'anchor', to: 'inv', type: 'solid' }]);
    const before = JSON.stringify(map);
    const copy = buildOpenDocument(map, checkCompleteness(map).additions);
    assert.strictEqual(JSON.stringify(map), before);
    assert.strictEqual(copy.nodes.length, map.nodes.length + 1);
  });

  test("preserves the document's own fields and key order", () => {
    const map = {
      $schema: 'https://example.com/sequentdraw.schema.json',
      title: 'map',
      groups: [{ id: 'g', label: 'G' }],
      nodes: [...FRAME_NODES, { id: 'inv', label: 'Invoice', kind: 'artifact', layers: ['business'], parentId: 'g' }],
      edges: [...FRAME_EDGES, { from: 'anchor', to: 'inv', type: 'solid' }],
      notes: [{ id: 'n1', content: 'hello' }],
    };
    const copy = buildOpenDocument(map, checkCompleteness(map).additions);
    assert.deepStrictEqual(Object.keys(copy), Object.keys(map));
    assert.strictEqual(copy.$schema, map.$schema);
    assert.strictEqual(copy.notes[0].id, 'n1');
  });

  test('with nothing to add, it returns an equal document', () => {
    const map = doc([]);
    const copy = buildOpenDocument(map, checkCompleteness(map).additions);
    assert.deepStrictEqual(copy, map);
  });
});

describe('the fixture measurement (docs/design/business-map.md:205-222)', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

  test('the rules fire exactly four times on examples/medusa-return-flow.json, and only those four', () => {
    const result = checkCompleteness(fixture);
    assert.deepStrictEqual(
      result.errors.map(e => [e.path, e.code]),
      [
        ['/nodes/9', 'artifact-no-recipient'], // refund_out: money has left the store, no edge reaches the customer
        ['/nodes/32', 'unhappy-path-no-owner'], // req_action
        ['/nodes/34', 'unhappy-path-no-owner'], // partial
        ['/nodes/35', 'unhappy-path-no-owner'], // cancel
      ]
    );
    // Rules 2, 3, 4, 5 and 6a fire zero times.
    const codes = new Set(codesOf(result));
    ['input-no-source-actor', 'handoff-undrawn', 'decision-no-decider', 'flow-dead-end', 'unhappy-paths-missing'].forEach(code => {
      assert.strictEqual(codes.has(code), false, code);
    });
  });

  test('the subjects are the documented node ids', () => {
    const result = checkCompleteness(fixture);
    const subjects = result.errors.map(e => fixture.nodes[Number(e.path.split('/')[2])].id);
    assert.deepStrictEqual(subjects, ['refund_out', 'req_action', 'partial', 'cancel']);
    assert.deepStrictEqual(result.additions.nodes.map(n => n.id), [
      'q_recipient_refund_out',
      'q_owner_req_action',
      'q_owner_partial',
      'q_owner_cancel',
    ]);
  });

  test('the emitted copy validates, re-checks clean, and has no orphan node', () => {
    const result = checkCompleteness(fixture);
    const copy = buildOpenDocument(fixture, result.additions);
    assert.doesNotThrow(() => validateDoc(copy));
    assert.deepStrictEqual(checkCompleteness(copy).errors, []);
  });
});
