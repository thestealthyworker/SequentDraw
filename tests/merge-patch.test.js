// src/n8n/merge.js: applying a small patch to an existing map, so a skill
// adds findings, suggestions and corrections without re-typing the whole
// document (`sequentdraw check <base.json> --merge <patch.json|->`).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { applyPatch, PATCH_LIMITS } = require('../src/n8n/merge');
const { validateDoc } = require('../src/n8n/validate');

const BASE = Object.freeze({
  title: 'Base',
  groups: [{ id: 'g1', label: 'Group', color: 'teal' }],
  nodes: [
    { id: 'a', label: 'A', kind: 'service', parentId: 'g1' },
    { id: 'b', label: 'B', kind: 'service', parentId: 'g1' },
    { id: 'c', label: 'C', kind: 'service', parentId: 'g1' },
  ],
  edges: [
    { from: 'a', to: 'b', type: 'solid' },
    { from: 'b', to: 'c', type: 'solid' },
  ],
  notes: [{ id: 'n1', content: 'Note', attachTo: ['a'], color: 'yellow' }],
});

function codes(result) {
  return result.errors.map(e => e.code);
}

describe('additions', () => {
  test('appends nodes, edges and notes after the existing ones', () => {
    const { doc, errors } = applyPatch(BASE, {
      nodes: [{ id: 'd', label: 'D', kind: 'service', parentId: 'g1' }],
      edges: [{ from: 'c', to: 'd', type: 'dashed' }],
      notes: [{ id: 'n_review_x', content: 'Consider: x', attachTo: ['d'], color: 'gold' }],
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc.nodes.map(n => n.id), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual(doc.edges.map(e => `${e.from}>${e.to}`), ['a>b', 'b>c', 'c>d']);
    assert.deepStrictEqual(doc.notes.map(n => n.id), ['n1', 'n_review_x']);
    assert.strictEqual(doc.title, 'Base');
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('adds a notes array when the base has none', () => {
    const { notes, ...noNotes } = BASE;
    const { doc, errors } = applyPatch(noNotes, { notes: [{ id: 'n2', content: 'x', color: 'gold' }] });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc.notes.map(n => n.id), ['n2']);
  });

  test('never mutates the base or the patch', () => {
    const base = JSON.parse(JSON.stringify(BASE));
    const patch = { nodes: [{ id: 'd', label: 'D', kind: 'service' }], remove: { nodes: ['c'] } };
    const baseCopy = JSON.stringify(base);
    const patchCopy = JSON.stringify(patch);
    applyPatch(base, patch);
    assert.strictEqual(JSON.stringify(base), baseCopy);
    assert.strictEqual(JSON.stringify(patch), patchCopy);
  });

  test('an empty patch returns an equal document', () => {
    const { doc, errors } = applyPatch(BASE, {});
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc, JSON.parse(JSON.stringify(BASE)));
  });
});

describe('removals', () => {
  test('removing a node also removes every edge touching it', () => {
    const { doc, errors } = applyPatch(BASE, { remove: { nodes: ['b'] } });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc.nodes.map(n => n.id), ['a', 'c']);
    assert.deepStrictEqual(doc.edges, []);
  });

  test('removes edges by from and to', () => {
    const { doc, errors } = applyPatch(BASE, { remove: { edges: [{ from: 'b', to: 'c' }] } });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc.edges.map(e => `${e.from}>${e.to}`), ['a>b']);
  });

  test('removes notes by id', () => {
    const { doc, errors } = applyPatch(BASE, { remove: { notes: ['n1'] } });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(doc.notes, []);
  });

  test('removal runs before additions, so a node can be replaced under the same id', () => {
    // Accepting a suggestion: remove it, add it back without status/rationale/cites.
    const base = {
      ...BASE,
      nodes: [...BASE.nodes, { id: 's_x', label: 'X', kind: 'service', status: 'suggested', source: 'model', rationale: 'r', cites: ['a'], integration: 'slack' }],
      edges: [...BASE.edges, { from: 'a', to: 's_x', type: 'dashed' }],
    };
    const { doc, errors } = applyPatch(base, {
      remove: { nodes: ['s_x'] },
      nodes: [{ id: 's_x', label: 'X', kind: 'service', source: 'user', integration: 'slack' }],
      edges: [{ from: 'a', to: 's_x', type: 'dashed' }],
    });
    assert.deepStrictEqual(errors, []);
    const accepted = doc.nodes.find(n => n.id === 's_x');
    assert.strictEqual(accepted.status, undefined);
    assert.strictEqual(accepted.source, 'user');
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('removing something that is not there is an error', () => {
    const result = applyPatch(BASE, { remove: { nodes: ['zz'], edges: [{ from: 'c', to: 'a' }], notes: ['n9'] } });
    assert.deepStrictEqual(codes(result), ['merge-remove-unknown-node', 'merge-remove-unknown-edge', 'merge-remove-unknown-note']);
    assert.strictEqual(result.doc, null);
    assert.strictEqual(result.errors[0].path, '/remove/nodes/0');
    assert.match(result.errors[0].message, /"zz" is not a node in the base document/);
  });
});

describe('ids', () => {
  test('an added node whose id is already taken is an error, not an overwrite', () => {
    const result = applyPatch(BASE, { nodes: [{ id: 'a', label: 'Other', kind: 'human' }] });
    assert.deepStrictEqual(codes(result), ['merge-duplicate-id']);
    assert.strictEqual(result.errors[0].path, '/nodes/0/id');
    assert.strictEqual(result.doc, null);
  });

  test('ids are unique across nodes, groups and notes, and within the patch', () => {
    const result = applyPatch(BASE, {
      nodes: [{ id: 'g1', label: 'x', kind: 'service' }, { id: 'd', label: 'D', kind: 'service' }],
      notes: [{ id: 'd', content: 'x', color: 'gold' }, { id: 'n1', content: 'y', color: 'gold' }],
    });
    assert.deepStrictEqual(codes(result), ['merge-duplicate-id', 'merge-duplicate-id', 'merge-duplicate-id']);
    assert.deepStrictEqual(result.errors.map(e => e.path), ['/nodes/0/id', '/notes/0/id', '/notes/1/id']);
  });

  test('an id freed by a removal can be reused', () => {
    const { errors } = applyPatch(BASE, { remove: { notes: ['n1'] }, notes: [{ id: 'n1', content: 'new', color: 'gold' }] });
    assert.deepStrictEqual(errors, []);
  });
});

describe('shape and bounds', () => {
  test('the patch must be an object with known keys', () => {
    assert.deepStrictEqual(codes(applyPatch(BASE, [])), ['merge-invalid-patch']);
    assert.deepStrictEqual(codes(applyPatch(BASE, null)), ['merge-invalid-patch']);
    const unknown = applyPatch(BASE, { node: [] });
    assert.deepStrictEqual(codes(unknown), ['merge-unknown-key']);
    assert.match(unknown.errors[0].message, /"node".*nodes, edges, notes, tour, remove/);
    assert.deepStrictEqual(codes(applyPatch(BASE, { remove: { groups: ['g1'] } })), ['merge-unknown-key']);
  });

  test('lists must be arrays of objects or ids', () => {
    const result = applyPatch(BASE, { nodes: {}, edges: ['x'], remove: { nodes: [3], edges: [{ from: 'a' }] } });
    assert.deepStrictEqual(codes(result), ['merge-invalid-list', 'merge-invalid-item', 'merge-invalid-item', 'merge-invalid-item']);
  });

  test('the base must be a document with node and edge arrays', () => {
    assert.deepStrictEqual(codes(applyPatch([], {})), ['merge-invalid-base']);
    assert.deepStrictEqual(codes(applyPatch({ title: 't', nodes: {}, edges: [] }, {})), ['merge-invalid-base']);
  });

  test('an oversized list is rejected before any item is read', () => {
    const nodes = Array.from({ length: PATCH_LIMITS.nodes + 1 }, (_, i) => ({ id: `x${i}` }));
    const result = applyPatch(BASE, { nodes });
    assert.deepStrictEqual(codes(result), ['merge-too-many']);
    assert.strictEqual(result.errors[0].path, '/nodes');
  });
});
