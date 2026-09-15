// checkEvidence(doc, bundle): the structural half of "evidence, not
// guesses" -- covers each error code in isolation against small,
// hand-built docs and bundles (no scan needed).

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { checkEvidence } = require('../src/scan/check-evidence');

function bundle(evidence) {
  return { evidence };
}

function codesOf(errors) {
  return errors.map(e => e.code);
}

describe('checkEvidence: evidence-required', () => {
  test('a scan-sourced node with no evidence array is flagged', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'scan' }], edges: [] };
    const errors = checkEvidence(doc, bundle([]));
    assert.ok(codesOf(errors).includes('evidence-required'));
  });

  test('a scan-sourced node with an empty evidence array is flagged', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'scan', evidence: [] }], edges: [] };
    const errors = checkEvidence(doc, bundle([]));
    assert.ok(codesOf(errors).includes('evidence-required'));
  });

  test('a scan-sourced edge with no evidence is flagged', () => {
    const doc = {
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'solid', source: 'scan' }],
    };
    const errors = checkEvidence(doc, bundle([]));
    assert.ok(codesOf(errors).includes('evidence-required'));
  });

  test('a user-sourced node with no evidence is NOT flagged', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'user' }], edges: [] };
    assert.deepStrictEqual(checkEvidence(doc, bundle([])), []);
  });
});

describe('checkEvidence: unknown-evidence', () => {
  test('a cited id absent from the bundle is flagged', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'scan', evidence: ['ev404'] }], edges: [] };
    const errors = checkEvidence(doc, bundle([{ id: 'ev1', kind: 'manifest-dependency', path: 'x', value: 'x' }]));
    assert.ok(codesOf(errors).includes('unknown-evidence'));
  });

  test('a cited id present in the bundle is not flagged as unknown', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'scan', evidence: ['ev1'] }], edges: [] };
    const errors = checkEvidence(doc, bundle([{ id: 'ev1', kind: 'manifest-dependency', path: 'x', value: 'x' }]));
    assert.strictEqual(codesOf(errors).includes('unknown-evidence'), false);
  });
});

describe('checkEvidence: edge-evidence-mismatch', () => {
  const evidence = [
    { id: 'ev1', kind: 'compose-service', path: 'docker-compose.yml', line: 2, value: 'vote' },
    { id: 'ev2', kind: 'compose-service', path: 'docker-compose.yml', line: 5, value: 'redis' },
    { id: 'ev3', kind: 'depends-on', path: 'docker-compose.yml', line: 3, from: 'vote', to: 'redis' },
    { id: 'ev4', kind: 'manifest-dependency', path: 'package.json', line: 1, value: 'lodash' },
  ];

  function edgeDoc(edgeEvidenceIds) {
    return {
      nodes: [
        { id: 'vote', label: 'vote', kind: 'service', source: 'scan', evidence: ['ev1'] },
        { id: 'redis', label: 'redis', kind: 'service', source: 'scan', evidence: ['ev2'] },
      ],
      edges: [{ from: 'vote', to: 'redis', type: 'solid', source: 'scan', evidence: edgeEvidenceIds }],
    };
  }

  test('a depends-on fact that actually connects the two endpoints passes', () => {
    const errors = checkEvidence(edgeDoc(['ev3']), bundle(evidence));
    assert.strictEqual(codesOf(errors).includes('edge-evidence-mismatch'), false);
  });

  test('citing only an unrelated manifest-dependency fact is flagged', () => {
    const errors = checkEvidence(edgeDoc(['ev4']), bundle(evidence));
    assert.ok(codesOf(errors).includes('edge-evidence-mismatch'));
  });

  test('an sdk-import fact naming one endpoint\'s tech is accepted as a connection', () => {
    const withImport = [
      ...evidence,
      { id: 'ev5', kind: 'sdk-import', path: 'src/index.js', line: 1, value: 'redis', tech: 'redis' },
    ];
    const errors = checkEvidence(edgeDoc(['ev5']), bundle(withImport));
    assert.strictEqual(codesOf(errors).includes('edge-evidence-mismatch'), false);
  });
});

describe('checkEvidence: evidence-on-model-node', () => {
  test('a model-sourced node citing evidence while not open is flagged', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'model', evidence: ['ev1'] }], edges: [] };
    const errors = checkEvidence(doc, bundle([{ id: 'ev1', kind: 'manifest-dependency', path: 'x', value: 'x' }]));
    assert.ok(codesOf(errors).includes('evidence-on-model-node'));
  });

  test('a model-sourced OPEN node citing evidence is allowed', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'model', status: 'open', evidence: ['ev1'] }], edges: [] };
    const errors = checkEvidence(doc, bundle([{ id: 'ev1', kind: 'manifest-dependency', path: 'x', value: 'x' }]));
    assert.strictEqual(codesOf(errors).includes('evidence-on-model-node'), false);
  });

  test('a scan-sourced node citing evidence is never flagged by this rule', () => {
    const doc = { nodes: [{ id: 'a', label: 'A', kind: 'service', source: 'scan', evidence: ['ev1'] }], edges: [] };
    const errors = checkEvidence(doc, bundle([{ id: 'ev1', kind: 'manifest-dependency', path: 'x', value: 'x' }]));
    assert.strictEqual(codesOf(errors).includes('evidence-on-model-node'), false);
  });
});

describe('checkEvidence: general robustness', () => {
  test('returns [] for a non-object doc rather than throwing', () => {
    assert.deepStrictEqual(checkEvidence(null, bundle([])), []);
    assert.deepStrictEqual(checkEvidence('not a doc', bundle([])), []);
  });

  test('a fully clean doc against a real bundle produces no errors', () => {
    const doc = {
      nodes: [
        { id: 'vote', label: 'vote', kind: 'service', source: 'scan', evidence: ['ev1'] },
        { id: 'redis', label: 'redis', kind: 'service', source: 'scan', evidence: ['ev2'] },
      ],
      edges: [{ from: 'vote', to: 'redis', type: 'solid', source: 'scan', evidence: ['ev3'] }],
    };
    const errors = checkEvidence(doc, bundle([
      { id: 'ev1', kind: 'compose-service', path: 'docker-compose.yml', value: 'vote' },
      { id: 'ev2', kind: 'compose-service', path: 'docker-compose.yml', value: 'redis' },
      { id: 'ev3', kind: 'depends-on', path: 'docker-compose.yml', from: 'vote', to: 'redis' },
    ]));
    assert.deepStrictEqual(errors, []);
  });
});
