// Suggestion fields in validateDoc() (docs/design/suggestion-agent.md §3,
// owner decision Q4, 2026-09-17): `cites` and `integration` on nodes, and
// the five-suggestion cap. Mirrors the `rationale` rule: required on a
// suggested node, forbidden elsewhere -- except `integration`, which stays
// on a node after its suggestion is accepted.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { validateDoc, ValidationError } = require('../src/n8n/validate');

// Two real nodes and one complete suggestion (`sug`) that cites `web`.
function suggestionDoc(mutate) {
  const doc = {
    title: 'Suggestion map',
    nodes: [
      { id: 'web', label: 'Web', kind: 'service' },
      { id: 'api', label: 'Api', kind: 'service' },
      {
        id: 'sug',
        label: 'Slack',
        kind: 'service',
        status: 'suggested',
        source: 'model',
        rationale: 'Api failures reach nobody.',
        cites: ['api'],
        integration: 'slack',
      },
    ],
    edges: [
      { from: 'web', to: 'api', type: 'solid' },
      { from: 'api', to: 'sug', type: 'dashed' },
    ],
  };
  if (mutate) mutate(doc);
  return doc;
}

function errorsOf(doc) {
  try {
    validateDoc(doc);
  } catch (e) {
    assert.ok(e instanceof ValidationError, `expected ValidationError, got ${e}`);
    return e.errors;
  }
  assert.fail('validateDoc should have thrown');
}

function findCode(errors, code) {
  const found = errors.find(e => e.code === code);
  assert.ok(found, `expected "${code}", got [${errors.map(e => e.code).join(', ')}]`);
  return found;
}

const sug = doc => doc.nodes[2];

describe('valid suggestions', () => {
  test('a suggested node with rationale, cites and integration passes', () => {
    assert.doesNotThrow(() => validateDoc(suggestionDoc()));
  });

  test('cites may list several distinct real nodes (up to 10)', () => {
    assert.doesNotThrow(() => validateDoc(suggestionDoc(d => { sug(d).cites = ['web', 'api']; })));
  });

  test('integration on a confirmed node passes (kept after acceptance)', () => {
    const doc = suggestionDoc(d => {
      const n = sug(d);
      n.status = 'confirmed';
      n.source = 'user';
      delete n.rationale;
      delete n.cites;
    });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('integration on an open node passes', () => {
    const doc = suggestionDoc(d => {
      d.nodes[1] = { ...d.nodes[1], status: 'open', prompt: 'Which API host?', integration: 'stripe' };
    });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('exactly five suggested nodes passes', () => {
    const doc = suggestionDoc(d => {
      for (let i = 0; i < 4; i++) {
        d.nodes.push({ ...sug(d), id: `extra${i}` });
        d.edges.push({ from: 'api', to: `extra${i}`, type: 'dashed' });
      }
    });
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

describe('cites', () => {
  test('missing on a suggested node: cites-required at /nodes/2/cites', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { delete sug(d).cites; })), 'cites-required');
    assert.strictEqual(e.path, '/nodes/2/cites');
  });

  test('empty array on a suggested node: cites-required', () => {
    findCode(errorsOf(suggestionDoc(d => { sug(d).cites = []; })), 'cites-required');
  });

  test('on a confirmed node: cites-not-allowed', () => {
    const doc = suggestionDoc(d => { d.nodes[0].cites = ['api']; });
    assert.strictEqual(findCode(errorsOf(doc), 'cites-not-allowed').path, '/nodes/0/cites');
  });

  test('on an open node, and on a node with no status: cites-not-allowed', () => {
    findCode(errorsOf(suggestionDoc(d => { d.nodes[0].status = 'open'; d.nodes[0].cites = ['api']; })), 'cites-not-allowed');
    findCode(errorsOf(suggestionDoc(d => { d.nodes[0].cites = []; })), 'cites-not-allowed');
  });

  test('not an array: invalid-cites', () => {
    findCode(errorsOf(suggestionDoc(d => { sug(d).cites = 'api'; })), 'invalid-cites');
  });

  test('more than 10 entries: invalid-cites', () => {
    const doc = suggestionDoc(d => {
      for (let i = 0; i < 11; i++) {
        d.nodes.push({ id: `r${i}`, label: `R${i}`, kind: 'service' });
        d.edges.push({ from: 'web', to: `r${i}`, type: 'solid' });
      }
      sug(d).cites = Array.from({ length: 11 }, (_, i) => `r${i}`);
    });
    const errors = errorsOf(doc);
    assert.strictEqual(findCode(errors, 'invalid-cites').path, '/nodes/2/cites');
    assert.strictEqual(errors.some(e => e.code === 'unknown-cite'), false);
  });

  test('an entry that is not a valid id: invalid-cites', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { sug(d).cites = ['api', 'not an id']; })), 'invalid-cites');
    assert.strictEqual(e.path, '/nodes/2/cites/1');
  });

  test('a duplicate entry: duplicate-cite', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { sug(d).cites = ['api', 'web', 'api']; })), 'duplicate-cite');
    assert.strictEqual(e.path, '/nodes/2/cites/2');
  });

  test('an id that is not a declared node: unknown-cite', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { sug(d).cites = ['api', 'ghost']; })), 'unknown-cite');
    assert.strictEqual(e.path, '/nodes/2/cites/1');
    assert.match(e.message, /"ghost"/);
  });

  test('a cite may point at a node declared later in the array', () => {
    const doc = suggestionDoc(d => {
      d.nodes.push({ id: 'late', label: 'Late', kind: 'service' });
      d.edges.push({ from: 'api', to: 'late', type: 'solid' });
      sug(d).cites = ['late'];
    });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a cite pointing at another suggested node: cite-is-suggested', () => {
    const doc = suggestionDoc(d => {
      d.nodes.push({ ...sug(d), id: 'sug2', label: 'Gmail', integration: 'gmail', cites: ['sug'] });
      d.edges.push({ from: 'sug', to: 'sug2', type: 'dashed' });
    });
    const errors = errorsOf(doc);
    const e = findCode(errors, 'cite-is-suggested');
    assert.strictEqual(e.path, '/nodes/3/cites/0');
    assert.strictEqual(errors.some(x => x.code === 'unknown-cite'), false);
  });

  test('a suggested node citing itself: cite-is-suggested', () => {
    findCode(errorsOf(suggestionDoc(d => { sug(d).cites = ['sug']; })), 'cite-is-suggested');
  });
});

describe('integration', () => {
  test('missing on a suggested node: integration-required at /nodes/2/integration', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { delete sug(d).integration; })), 'integration-required');
    assert.strictEqual(e.path, '/nodes/2/integration');
  });

  test('not a string: invalid-integration', () => {
    findCode(errorsOf(suggestionDoc(d => { sug(d).integration = 42; })), 'invalid-integration');
  });

  test('not a catalogue id: unknown-integration', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { sug(d).integration = 'n8n-nodes-base.slack'; })), 'unknown-integration');
    assert.strictEqual(e.path, '/nodes/2/integration');
  });

  test('not a catalogue id on a confirmed node: unknown-integration', () => {
    findCode(errorsOf(suggestionDoc(d => { d.nodes[0].integration = 'not-a-tool'; })), 'unknown-integration');
  });

  test('a hostile, very long integration value is truncated in the message', () => {
    const e = findCode(errorsOf(suggestionDoc(d => { sug(d).integration = 'x'.repeat(10000); })), 'unknown-integration');
    assert.ok(e.message.length < 300);
  });
});

describe('too-many-suggestions', () => {
  test('a sixth suggested node fails with one error at /nodes', () => {
    const doc = suggestionDoc(d => {
      for (let i = 0; i < 5; i++) {
        d.nodes.push({ ...sug(d), id: `extra${i}` });
        d.edges.push({ from: 'api', to: `extra${i}`, type: 'dashed' });
      }
    });
    const errors = errorsOf(doc);
    const matches = errors.filter(e => e.code === 'too-many-suggestions');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].path, '/nodes');
    assert.match(matches[0].message, /6 suggested nodes, maximum is 5/);
  });
});

describe('every problem in one pass', () => {
  test('one document reports every suggestion code together', () => {
    const doc = suggestionDoc(d => {
      d.nodes[0].cites = ['api']; // cites-not-allowed
      delete sug(d).integration; // integration-required
      sug(d).cites = ['ghost', 'ghost']; // unknown-cite + duplicate-cite
      d.nodes.push({ ...sug(d), id: 's2', integration: 'nope', cites: ['sug'] }); // unknown-integration + cite-is-suggested
      d.edges.push({ from: 'api', to: 's2', type: 'dashed' });
      d.nodes.push({ id: 's3', label: 'S3', kind: 'service', status: 'suggested', rationale: 'r', integration: 'slack' }); // cites-required
      d.edges.push({ from: 'api', to: 's3', type: 'dashed' });
      for (let i = 0; i < 3; i++) {
        d.nodes.push({ id: `x${i}`, label: 'X', kind: 'service', status: 'suggested', rationale: 'r', cites: ['web'], integration: 'slack' });
        d.edges.push({ from: 'api', to: `x${i}`, type: 'dashed' });
      } // 6 suggested in total: too-many-suggestions
    });
    const codes = new Set(errorsOf(doc).map(e => e.code));
    for (const code of [
      'cites-not-allowed',
      'integration-required',
      'unknown-cite',
      'duplicate-cite',
      'unknown-integration',
      'cite-is-suggested',
      'cites-required',
      'too-many-suggestions',
    ]) {
      assert.ok(codes.has(code), `missing ${code} in [${[...codes].join(', ')}]`);
    }
  });
});
