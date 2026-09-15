// One-off generator for tests/fixtures/schema/*.json. Run manually with
// `node scripts/gen-schema-fixtures.js` after editing this file; the
// fixtures it writes are committed and read directly by
// tests/schema-parity.test.js, this script is not part of the test run.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'schema');

function write(name, doc) {
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(doc, null, 2) + '\n');
}

function baseTwoNodeDoc(overrides) {
  return Object.assign(
    {
      title: 'Base doc',
      groups: [{ id: 'g1', label: 'Group one' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'service', parentId: 'g1' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
    },
    overrides,
  );
}

// -----------------------------------------------------------------------
// Valid fixtures
// -----------------------------------------------------------------------

write('minimal-valid.json', {
  title: 'Minimal doc',
  nodes: [{ id: 'a', label: 'A', kind: 'service' }],
  edges: [],
});

write('suggested-node-valid.json', {
  title: 'Suggestion doc',
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'b', label: 'Job queue', kind: 'service', status: 'suggested', rationale: 'Three long-running steps run synchronously.' },
  ],
  edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
});

write('tour-valid.json', {
  title: 'Tour doc',
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'b', label: 'B', kind: 'service' },
  ],
  edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
  tour: [{ order: 1, title: 'How it starts', description: 'A hands off to B.', nodeIds: ['a', 'b'] }],
});

write('notes-valid.json', {
  title: 'Notes doc',
  groups: [{ id: 'g1', label: 'Group one', color: 'blue' }],
  nodes: [{ id: 'a', label: 'A', kind: 'service', parentId: 'g1' }],
  edges: [],
  notes: [
    { id: 'n_map', content: 'Map-level note.' },
    { id: 'n_attached', content: 'Attached note.', attachTo: ['a', 'g1'], color: 'gold' },
  ],
});

// medusa-valid.json is a copy of examples/medusa-return-flow.json, written
// separately below by copying the file (kept in sync by the test's own
// "medusa fixture matches the example" check rather than duplicated here).

// -----------------------------------------------------------------------
// Invalid: structural (ajv and validateDoc must both reject)
// -----------------------------------------------------------------------

write('structural-missing-title.json', (() => {
  const d = baseTwoNodeDoc();
  delete d.title;
  return d;
})());

write('structural-title-too-long.json', baseTwoNodeDoc({ title: 'x'.repeat(121) }));

write('structural-missing-node-kind.json', (() => {
  const d = baseTwoNodeDoc();
  delete d.nodes[0].kind;
  return d;
})());

write('structural-invalid-node-kind.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].kind = 'bogus';
  return d;
})());

write('structural-missing-edge-type.json', (() => {
  const d = baseTwoNodeDoc();
  delete d.edges[0].type;
  return d;
})());

write('structural-invalid-group-color.json', (() => {
  const d = baseTwoNodeDoc();
  d.groups[0].color = 'orange';
  return d;
})());

write('structural-malformed-node-id.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].id = 'bad id with spaces';
  return d;
})());

write('structural-suggested-without-rationale.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].status = 'suggested';
  return d;
})());

write('structural-rationale-without-suggested.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].rationale = 'looks useful';
  return d;
})());

write('structural-unknown-field-on-node.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].sub_label = 'typo';
  return d;
})());

write('structural-sublabel-too-long-chars.json', (() => {
  const d = baseTwoNodeDoc();
  d.nodes[0].sublabel = 'x'.repeat(61);
  return d;
})());

write('structural-note-content-empty.json', baseTwoNodeDoc({ notes: [{ id: 'n1', content: '' }] }));

write('structural-group-with-parent-id.json', (() => {
  const d = baseTwoNodeDoc();
  d.groups[0].parentId = 'g1';
  return d;
})());

write('structural-too-many-nodes.json', {
  title: 'Too many nodes',
  nodes: Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service' })),
  edges: Array.from({ length: 100 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: 'solid', condition: null })),
});

write('structural-too-many-notes.json', baseTwoNodeDoc({ notes: Array.from({ length: 21 }, (_, i) => ({ id: `note${i}`, content: 'hi' })) }));

write('structural-condition-on-solid-edge.json', (() => {
  const d = baseTwoNodeDoc();
  d.edges[0].condition = 'if approved';
  return d;
})());

// Fix-round additions: the new array-length and field-count caps are
// expressible in the schema (maxItems / maxProperties), so these are
// structural (both ajv and validateDoc reject), not cross-reference.

write('structural-too-many-edges.json', {
  title: 'Too many edges',
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'b', label: 'B', kind: 'service' },
  ],
  edges: Array.from({ length: 501 }, () => ({ from: 'a', to: 'b', type: 'solid', condition: null })),
});

write('structural-too-many-groups.json', {
  title: 'Too many groups',
  groups: Array.from({ length: 51 }, (_, i) => ({ id: `g${i}`, label: `Group ${i}` })),
  nodes: [{ id: 'a', label: 'A', kind: 'service' }],
  edges: [],
});

write('structural-too-many-tour-entries.json', {
  title: 'Too many tour entries',
  nodes: [{ id: 'a', label: 'A', kind: 'service' }],
  edges: [],
  tour: Array.from({ length: 51 }, (_, i) => ({ order: i + 1, title: `Step ${i}`, description: 'D', nodeIds: ['a'] })),
});

write('structural-too-many-fields-on-node.json', (() => {
  const node = { id: 'a', label: 'A', kind: 'service' };
  for (let i = 0; i < 205; i++) node[`extra_field_${i}`] = true;
  return {
    title: 'Too many fields',
    nodes: [node, { id: 'b', label: 'B', kind: 'service' }],
    edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
  };
})());

// -----------------------------------------------------------------------
// Invalid: cross-reference only (ajv accepts, validateDoc must reject)
// -----------------------------------------------------------------------

write('crossref-edge-references-unknown-node.json', {
  title: 'Unknown edge target',
  nodes: [{ id: 'a', label: 'A', kind: 'service' }],
  edges: [{ from: 'a', to: 'does-not-exist', type: 'solid', condition: null }],
});

write('crossref-node-parentid-unknown-group.json', {
  title: 'Unknown group',
  nodes: [{ id: 'a', label: 'A', kind: 'service', parentId: 'does-not-exist' }],
  edges: [],
});

write('crossref-orphan-node.json', {
  title: 'Orphan node',
  groups: [{ id: 'g1', label: 'G' }],
  nodes: [
    { id: 'a', label: 'A', kind: 'service', parentId: 'g1' },
    { id: 'b', label: 'B', kind: 'service', parentId: 'g1' },
  ],
  edges: [],
});

write('crossref-sublabel-word-count.json', baseTwoNodeDoc({}));
(() => {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, 'crossref-sublabel-word-count.json'), 'utf8'));
  d.nodes[0].sublabel = 'on request on receipt';
  write('crossref-sublabel-word-count.json', d);
})();

write('crossref-duplicate-node-id.json', {
  title: 'Duplicate node id',
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'a', label: 'A2', kind: 'service' },
  ],
  edges: [],
});

write('crossref-note-attachto-unknown.json', baseTwoNodeDoc({ notes: [{ id: 'n1', content: 'hi', attachTo: ['does-not-exist'] }] }));

write('crossref-duplicate-tour-order.json', {
  title: 'Duplicate tour order',
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'b', label: 'B', kind: 'service' },
  ],
  edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
  tour: [
    { order: 1, title: 'T1', description: 'D1', nodeIds: ['a'] },
    { order: 1, title: 'T2', description: 'D2', nodeIds: ['b'] },
  ],
});

write('crossref-tour-nodeids-unknown.json', {
  title: 'Unknown tour node',
  nodes: [{ id: 'a', label: 'A', kind: 'service' }],
  edges: [],
  tour: [{ order: 1, title: 'T', description: 'D', nodeIds: ['does-not-exist'] }],
});

write('crossref-note-id-collides-with-node.json', baseTwoNodeDoc({ notes: [{ id: 'a', content: 'collides with node a' }] }));

write('crossref-whitespace-only-title.json', baseTwoNodeDoc({ title: '   ' }));

console.log('wrote fixtures to', DIR);
