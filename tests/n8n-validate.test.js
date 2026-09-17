// Validator tests: every SPEC invariant (docs/SPEC.md "Invariants the
// renderer validates before drawing"), the gap/suggestion fields, unknown
// field detection with "did you mean" hints, length caps, tour validation,
// multi-error reporting in a single throw, the linear-time performance
// bound, and the CLI's line-per-error output on an invalid file.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateDoc, ValidationError } = require('../src/n8n/validate');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src/n8n/cli.js');

function baseDoc(extra) {
  return Object.assign(
    {
      title: 't',
      groups: [{ id: 'g1', label: 'G', color: 'purple' }],
      nodes: [
        { id: 'n1', label: 'N', kind: 'service', icon: null, parentId: 'g1', layers: ['base'] },
        { id: 'n2', label: 'N2', kind: 'service', icon: null, parentId: null, layers: ['base'] },
      ],
      edges: [{ from: 'n1', to: 'n2', type: 'solid', condition: null }],
    },
    extra,
  );
}

// Runs validateDoc and returns the ValidationError (asserting one was
// thrown), so tests can inspect `.errors` freely.
function invalid(doc) {
  assert.throws(() => validateDoc(doc), ValidationError);
  try {
    validateDoc(doc);
  } catch (e) {
    return e;
  }
  throw new Error('unreachable');
}

function codesOf(err) {
  return err.errors.map(e => e.code);
}

function pathsOf(err) {
  return err.errors.map(e => e.path);
}

// ---------------------------------------------------------------------
// New invariants (not previously enforced)
// ---------------------------------------------------------------------

describe('orphan-node: a node with zero edges is an error unless it is the only node in its group', () => {
  test('two nodes sharing a group, neither with edges: both error', () => {
    const doc = {
      title: 't',
      groups: [{ id: 'g1', label: 'G' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'service', parentId: 'g1' },
        { id: 'b', label: 'B', kind: 'service', parentId: 'g1' },
      ],
      edges: [],
    };
    const err = invalid(doc);
    assert.strictEqual(codesOf(err).filter(c => c === 'orphan-node').length, 2);
    assert.deepStrictEqual(pathsOf(err).filter((p, i) => err.errors[i].code === 'orphan-node').sort(), ['/nodes/0', '/nodes/1']);
  });

  test('a single node alone in its group with zero edges is valid', () => {
    const doc = {
      title: 't',
      groups: [{ id: 'g1', label: 'G' }],
      nodes: [{ id: 'a', label: 'A', kind: 'service', parentId: 'g1' }],
      edges: [],
    };
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a single ungrouped node with zero edges is valid', () => {
    const doc = { title: 't', nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [] };
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('two ungrouped nodes, neither with edges: both error', () => {
    const doc = {
      title: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: [],
    };
    const err = invalid(doc);
    assert.strictEqual(codesOf(err).filter(c => c === 'orphan-node').length, 2);
  });

  test('a node with an edge never triggers orphan-node, even sharing a group with an orphan', () => {
    const doc = {
      title: 't',
      groups: [{ id: 'g1', label: 'G' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'service', parentId: 'g1' },
        { id: 'b', label: 'B', kind: 'service', parentId: 'g1' },
        { id: 'c', label: 'C', kind: 'service' },
      ],
      edges: [{ from: 'a', to: 'c', type: 'solid', condition: null }],
    };
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['orphan-node']);
    assert.strictEqual(err.errors[0].path, '/nodes/1'); // only "b" is orphaned
  });
});

describe('sublabel: 3 words or fewer', () => {
  test('a 4-word sublabel errors with sublabel-too-many-words', () => {
    const doc = baseDoc();
    doc.nodes[0].sublabel = 'on request, on receipt';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('sublabel-too-many-words'));
    const e = err.errors.find(x => x.code === 'sublabel-too-many-words');
    assert.strictEqual(e.path, '/nodes/0/sublabel');
    assert.match(e.message, /4 words/);
  });

  test('exactly 3 words is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].sublabel = 'request and receipt';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('1 word is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].sublabel = 'buyer';
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

describe('condition-requires-dashed: an edge with a non-null condition must be dashed', () => {
  test('a solid edge with a condition errors', () => {
    const doc = baseDoc();
    doc.edges[0].type = 'solid';
    doc.edges[0].condition = 'if approved';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('condition-requires-dashed'));
    const e = err.errors.find(x => x.code === 'condition-requires-dashed');
    assert.strictEqual(e.path, '/edges/0/condition');
  });

  test('a gutter edge with a condition errors', () => {
    const doc = baseDoc();
    doc.edges[0].type = 'gutter';
    doc.edges[0].condition = 'if approved';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('condition-requires-dashed'));
  });

  test('a dashed edge with a condition is valid', () => {
    const doc = baseDoc();
    doc.edges[0].type = 'dashed';
    doc.edges[0].condition = 'if approved';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a solid edge with no condition is valid', () => {
    const doc = baseDoc();
    doc.edges[0].type = 'solid';
    doc.edges[0].condition = null;
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

describe('too-many-nodes: no more than 100 nodes', () => {
  function docWithNNodes(n) {
    return {
      title: 't',
      nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service' })),
      edges: Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: 'solid', condition: null })),
    };
  }

  test('101 nodes errors with too-many-nodes', () => {
    const err = invalid(docWithNNodes(101));
    assert.ok(codesOf(err).includes('too-many-nodes'));
    const e = err.errors.find(x => x.code === 'too-many-nodes');
    assert.strictEqual(e.path, '/nodes');
  });

  test('exactly 100 nodes is accepted', () => {
    assert.doesNotThrow(() => validateDoc(docWithNNodes(100)));
  });
});

describe('group-nested: a group must not have a parentId', () => {
  test('a group with a parentId errors with group-nested', () => {
    const doc = {
      title: 't',
      groups: [{ id: 'g1', label: 'G', parentId: 'g1' }],
      nodes: [{ id: 'n1', label: 'N', kind: 'service' }],
      edges: [],
    };
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('group-nested'));
    const e = err.errors.find(x => x.code === 'group-nested');
    assert.strictEqual(e.path, '/groups/0/parentId');
  });

  test('a group without a parentId is valid', () => {
    const doc = {
      title: 't',
      groups: [{ id: 'g1', label: 'G' }],
      nodes: [{ id: 'n1', label: 'N', kind: 'service', parentId: 'g1' }],
      edges: [],
    };
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

describe('a hidden edge endpoint is a render concern, not a validation error', () => {
  test('an edge to a node not visible in any active layer still validates fine (no layer-visibility check exists)', () => {
    const doc = baseDoc();
    doc.nodes[0].layers = ['build'];
    doc.nodes[1].layers = ['business'];
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

// ---------------------------------------------------------------------
// Required fields and structural types
// ---------------------------------------------------------------------

describe('required structure and types', () => {
  test('missing title errors invalid-title', () => {
    const doc = baseDoc();
    delete doc.title;
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-title'));
  });

  test('empty title errors invalid-title', () => {
    const doc = baseDoc({ title: '' });
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-title'));
  });

  test('non-string title errors invalid-title', () => {
    const doc = baseDoc({ title: 42 });
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-title'));
  });

  test('missing node label errors invalid-label at the node path', () => {
    const doc = baseDoc();
    delete doc.nodes[0].label;
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'invalid-label');
    assert.ok(e);
    assert.strictEqual(e.path, '/nodes/0/label');
  });

  test('missing node id errors invalid-id', () => {
    const doc = baseDoc();
    delete doc.nodes[0].id;
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-id'));
  });

  test('missing node kind errors invalid-kind', () => {
    const doc = baseDoc();
    delete doc.nodes[0].kind;
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-kind'));
  });

  test('missing edge from/to/type all error', () => {
    const doc = baseDoc();
    delete doc.edges[0].from;
    delete doc.edges[0].to;
    delete doc.edges[0].type;
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-endpoint'));
    assert.ok(codesOf(err).includes('invalid-type'));
  });

  test('missing group id/label error', () => {
    const doc = baseDoc();
    delete doc.groups[0].id;
    delete doc.groups[0].label;
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-id'));
    assert.ok(codesOf(err).includes('invalid-label'));
  });

  test('doc.nodes not an array errors invalid-nodes', () => {
    const doc = baseDoc({ nodes: 'nope' });
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-nodes'));
  });

  test('doc.edges not an array errors invalid-edges', () => {
    const doc = baseDoc({ edges: 'nope' });
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-edges'));
  });

  test('a doc that is not an object throws a single invalid-doc error', () => {
    assert.throws(() => validateDoc(null), ValidationError);
    assert.throws(() => validateDoc('nope'), ValidationError);
    try {
      validateDoc([]);
    } catch (e) {
      assert.deepStrictEqual(codesOf(e), ['invalid-doc']);
    }
  });
});

// ---------------------------------------------------------------------
// Length caps
// ---------------------------------------------------------------------

describe('length caps', () => {
  test('title over 120 chars errors title-too-long', () => {
    const doc = baseDoc({ title: 'x'.repeat(121) });
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('title-too-long'));
  });
  test('title of exactly 120 chars is accepted', () => {
    assert.doesNotThrow(() => validateDoc(baseDoc({ title: 'x'.repeat(120) })));
  });

  test('node label over 80 chars errors label-too-long', () => {
    const doc = baseDoc();
    doc.nodes[0].label = 'x'.repeat(81);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('label-too-long'));
  });

  test('group label over 80 chars errors label-too-long', () => {
    const doc = baseDoc();
    doc.groups[0].label = 'x'.repeat(81);
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'label-too-long');
    assert.ok(e);
    assert.strictEqual(e.path, '/groups/0/label');
  });

  test('sublabel over 60 chars errors sublabel-too-long', () => {
    const doc = baseDoc();
    doc.nodes[0].sublabel = 'x'.repeat(61);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('sublabel-too-long'));
  });

  test('condition over 80 chars errors condition-too-long', () => {
    const doc = baseDoc();
    doc.edges[0].type = 'dashed';
    doc.edges[0].condition = 'x'.repeat(81);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('condition-too-long'));
  });

  test('prompt over 500 chars errors prompt-too-long', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'open';
    doc.nodes[0].prompt = 'x'.repeat(501);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('prompt-too-long'));
  });

  test('rationale over 500 chars errors rationale-too-long', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'suggested';
    doc.nodes[0].rationale = 'x'.repeat(501);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('rationale-too-long'));
  });
});

// ---------------------------------------------------------------------
// Gap and suggestion fields
// ---------------------------------------------------------------------

describe('gap and suggestion fields', () => {
  test('status defaults to confirmed: omitted status is valid', () => {
    const doc = baseDoc();
    delete doc.nodes[0].status;
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('status open/confirmed/suggested(with rationale, cites, integration) all validate', () => {
    for (const status of ['open', 'confirmed']) {
      const doc = baseDoc();
      doc.nodes[0].status = status;
      assert.doesNotThrow(() => validateDoc(doc), `status ${status} should validate`);
    }
    const suggestedDoc = baseDoc();
    suggestedDoc.nodes[0].status = 'suggested';
    suggestedDoc.nodes[0].rationale = 'three long-running steps run synchronously';
    suggestedDoc.nodes[0].cites = ['n2'];
    suggestedDoc.nodes[0].integration = 'slack';
    assert.doesNotThrow(() => validateDoc(suggestedDoc));
  });

  test('an invalid status value errors invalid-status', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'bogus';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-status'));
  });

  test('source scan/user/model all validate; an invalid source errors invalid-source', () => {
    for (const source of ['scan', 'user', 'model']) {
      const doc = baseDoc();
      doc.nodes[0].source = source;
      assert.doesNotThrow(() => validateDoc(doc));
    }
    const doc = baseDoc();
    doc.nodes[0].source = 'bogus';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-source'));
  });

  test('a suggested node without a rationale errors rationale-required', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'suggested';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('rationale-required'));
    const e = err.errors.find(x => x.code === 'rationale-required');
    assert.strictEqual(e.path, '/nodes/0/rationale');
  });

  test('a suggested node with an empty/whitespace rationale errors rationale-required', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'suggested';
    doc.nodes[0].rationale = '   ';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('rationale-required'));
  });

  test('a non-suggested node with a rationale errors rationale-not-allowed', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'confirmed';
    doc.nodes[0].rationale = 'looks useful';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('rationale-not-allowed'));
  });

  test('a node with no status at all and a rationale errors rationale-not-allowed (status defaults to confirmed)', () => {
    const doc = baseDoc();
    doc.nodes[0].rationale = 'looks useful';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('rationale-not-allowed'));
  });

  test('a node with an open status and a prompt validates', () => {
    const doc = baseDoc();
    doc.nodes[0].status = 'open';
    doc.nodes[0].prompt = 'The signed PDF is generated but no recipient appears in the code.';
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

// ---------------------------------------------------------------------
// Unknown fields, with "did you mean" hints
// ---------------------------------------------------------------------

describe('unknown-field detection', () => {
  test('an unknown top-level key errors unknown-field', () => {
    const doc = baseDoc({ unexpected_thing: true });
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.strictEqual(e.path, '/unexpected_thing');
  });

  test('$schema is an allowed top-level key', () => {
    const doc = baseDoc({ $schema: 'https://example.com/schema.json' });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('parent_id on a node suggests parentId', () => {
    const doc = baseDoc();
    doc.nodes[0].parent_id = 'g1';
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.match(e.message, /did you mean "parentId"/i);
  });

  test('sub_label on a node suggests sublabel', () => {
    const doc = baseDoc();
    doc.nodes[0].sub_label = 'x';
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.match(e.message, /did you mean "sublabel"/i);
  });

  test('layer (singular) on a node suggests layers', () => {
    const doc = baseDoc();
    doc.nodes[0].layer = ['base'];
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.match(e.message, /did you mean "layers"/i);
  });

  test('a wildly different unknown key gets no hint', () => {
    const doc = baseDoc();
    doc.nodes[0].completely_unrelated_xyz = 1;
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.ok(!/did you mean/i.test(e.message));
  });

  test('an unknown edge field errors unknown-field', () => {
    const doc = baseDoc();
    doc.edges[0].lable = 'typo';
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('unknown-field'));
  });

  test('an unknown group field errors unknown-field', () => {
    const doc = baseDoc();
    doc.groups[0].colour = 'purple';
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.match(e.message, /did you mean "color"/i);
  });

  test('an unknown note field errors unknown-field', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'hi', attach_to: ['n1'] }] });
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.match(e.message, /did you mean "attachTo"/i);
  });
});

// ---------------------------------------------------------------------
// Tour validation
// ---------------------------------------------------------------------

describe('tour validation', () => {
  function docWithTour(tour) {
    return baseDoc({ tour });
  }

  test('a valid tour validates', () => {
    const doc = docWithTour([{ order: 1, title: 'How a job starts', description: 'The flow begins.', nodeIds: ['n1', 'n2'] }]);
    const result = validateDoc(doc);
    assert.strictEqual(result.tour.length, 1);
  });

  test('doc.tour not an array errors invalid-tour', () => {
    const err = invalid(docWithTour('nope'));
    assert.ok(codesOf(err).includes('invalid-tour'));
  });

  test('a non-positive or non-integer order errors invalid-order', () => {
    for (const order of [0, -1, 1.5, 'one']) {
      const doc = docWithTour([{ order, title: 'T', description: 'D', nodeIds: ['n1'] }]);
      const err = invalid(doc);
      assert.ok(codesOf(err).includes('invalid-order'), `order ${order} should be invalid`);
    }
  });

  test('duplicate order values error duplicate-order', () => {
    const doc = docWithTour([
      { order: 1, title: 'T1', description: 'D1', nodeIds: ['n1'] },
      { order: 1, title: 'T2', description: 'D2', nodeIds: ['n2'] },
    ]);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('duplicate-order'));
  });

  test('title over 80 chars errors tour-title-too-long', () => {
    const doc = docWithTour([{ order: 1, title: 'x'.repeat(81), description: 'D', nodeIds: ['n1'] }]);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('tour-title-too-long'));
  });

  test('description over 500 chars errors tour-description-too-long', () => {
    const doc = docWithTour([{ order: 1, title: 'T', description: 'x'.repeat(501), nodeIds: ['n1'] }]);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('tour-description-too-long'));
  });

  test('empty nodeIds errors invalid-node-ids', () => {
    const doc = docWithTour([{ order: 1, title: 'T', description: 'D', nodeIds: [] }]);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-node-ids'));
  });

  test('a nodeIds entry referencing an unknown node errors unknown-node at the nodeIds index', () => {
    const doc = docWithTour([{ order: 1, title: 'T', description: 'D', nodeIds: ['n1', 'does-not-exist'] }]);
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-node');
    assert.ok(e);
    assert.strictEqual(e.path, '/tour/0/nodeIds/1');
  });

  test('missing title/description error', () => {
    const doc = docWithTour([{ order: 1, nodeIds: ['n1'] }]);
    const err = invalid(doc);
    assert.ok(codesOf(err).includes('invalid-tour-title'));
    assert.ok(codesOf(err).includes('invalid-tour-description'));
  });
});

// ---------------------------------------------------------------------
// Multiple problems in one document, reported together in one throw
// ---------------------------------------------------------------------

describe('multiple problems reported together in one throw', () => {
  test('a document with five unrelated problems throws once with all five', () => {
    const doc = {
      title: '', // invalid-title
      nodes: [
        { id: 'n1', label: 'N1', kind: 'bogus' }, // invalid-kind
        { id: 'n1', label: 'N1b', kind: 'service' }, // duplicate-id
      ],
      edges: [
        { from: 'n1', to: 'does-not-exist', type: 'solid', condition: null }, // unknown-node
      ],
      groups: [{ id: 'g1', label: 'G', parentId: 'g1' }], // group-nested
    };
    const err = invalid(doc);
    const codes = codesOf(err);
    assert.ok(codes.includes('invalid-title'));
    assert.ok(codes.includes('invalid-kind'));
    assert.ok(codes.includes('duplicate-id'));
    assert.ok(codes.includes('unknown-node'));
    assert.ok(codes.includes('group-nested'));
    assert.ok(err.errors.length >= 5, `expected at least 5 errors, got ${err.errors.length}`);
    // Each error carries a precise JSON Pointer path.
    for (const e of err.errors) {
      assert.strictEqual(typeof e.path, 'string');
      assert.strictEqual(typeof e.code, 'string');
      assert.strictEqual(typeof e.message, 'string');
    }
  });

  test('the thrown Error message summarises the count and lists the first few', () => {
    const doc = {
      title: '',
      nodes: [{ id: 'n1', label: 'N1', kind: 'bogus' }],
      edges: [],
    };
    try {
      validateDoc(doc);
      assert.fail('expected validateDoc to throw');
    } catch (e) {
      assert.strictEqual(e.name, 'ValidationError');
      assert.match(e.message, /\d+ validation errors? found/);
      assert.match(e.message, /invalid-title|title/);
      assert.match(e.message, /invalid-kind|kind/);
    }
  });
});

// ---------------------------------------------------------------------
// Performance bound
// ---------------------------------------------------------------------

describe('performance', () => {
  test('a 100-node / 300-edge / 20-note document validates in well under 50ms', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
      kind: 'service',
      layers: ['base'],
    }));
    const edges = Array.from({ length: 300 }, (_, i) => ({
      from: `n${i % 100}`,
      to: `n${(i + 7) % 100}`,
      type: 'solid',
      condition: null,
    }));
    const notes = Array.from({ length: 20 }, (_, i) => ({
      id: `note${i}`,
      content: `Note number ${i} describing something relevant.`,
      attachTo: [`n${i}`],
    }));
    const doc = { title: 'Perf doc', nodes, edges, notes };

    // Warm up once so JIT variance doesn't dominate a single sample.
    validateDoc(doc);

    const start = process.hrtime.bigint();
    const result = validateDoc(doc);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.strictEqual(result.nodes.length, 100);
    assert.ok(elapsedMs < 50, `validateDoc took ${elapsedMs.toFixed(2)}ms, expected well under 50ms`);
  });
});

// ---------------------------------------------------------------------
// CLI output format for an invalid file
// ---------------------------------------------------------------------

describe('CLI output for an invalid document', () => {
  function runCli(args, cwd) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  }

  function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-validate-cli-'));
    try {
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('an invalid doc exits 1, prints one line per error as "path  message", and writes nothing', () => {
    withTempDir(dir => {
      const inputPath = path.join(dir, 'bad.json');
      const outputPath = path.join(dir, 'out.html');
      const doc = {
        title: '',
        nodes: [{ id: 'n1', label: 'N1', kind: 'bogus' }],
        edges: [{ from: 'n1', to: 'nowhere', type: 'solid', condition: null }],
      };
      fs.writeFileSync(inputPath, JSON.stringify(doc));

      const result = runCli([inputPath, outputPath], dir);

      assert.strictEqual(result.status, 1);
      const lines = result.stderr.trim().split('\n');
      assert.ok(lines.length >= 3, `expected several error lines, got:\n${result.stderr}`);
      for (const line of lines) {
        assert.match(line, /^\/\S*\s\s.+/, `line should be "path  message": ${JSON.stringify(line)}`);
      }
      assert.ok(lines.some(l => l.startsWith('/title')));
      assert.ok(lines.some(l => l.startsWith('/nodes/0/kind')));
      assert.ok(lines.some(l => l.startsWith('/edges/0/to')));

      // Nothing written: only the input file we created ourselves exists.
      assert.deepStrictEqual(fs.readdirSync(dir), ['bad.json']);
    });
  });
});

// ---------------------------------------------------------------------
// Adversarial input / denial-of-service resistance
//
// Fix round: a lead-developer review measured validateDoc taking 289s on
// 2,000 unknown top-level keys of 50,000 characters each (the "did you
// mean" hint ran a Levenshtein DP on the full key), producing a 500,248
// character thrown message, and found the 100-node cap did not stop
// per-item work or bound the error list (50,000 nodes with an invalid
// kind produced 100,001 errors in 68ms; the cap error was reported
// alongside, not instead of, the per-item ones). Every case below both
// asserts correctness (the expected code, and that the result stayed
// small) and a hard time bound.
// ---------------------------------------------------------------------

describe('adversarial input: bounded time and bounded output', () => {
  const TIME_BOUND_MS = 200;

  // Runs fn() once, untimed, before measuring a second call, and forces a
  // GC pass in between when the runtime exposes one (npm test runs with
  // --expose-gc for exactly this). validateDoc never mutates its input, so
  // calling it twice is safe. Without this, building a pathological input
  // (e.g. 2,000 own properties each holding a 50,000-character string —
  // ~200MB of string data, enough to push V8 into dictionary-mode
  // property storage) can leave enough allocation pressure that a GC pause
  // lands inside the *next* timed call, measuring V8's garbage collector
  // instead of validateDoc. That pause is real but it is a property of the
  // test's own fixture-building, not of validateDoc, whose steady-state
  // cost on every case below is sub-millisecond.
  function timed(fn) {
    try {
      fn();
    } catch (_e) {
      // warm-up run; the assertions below check the real, timed run.
    }
    if (global.gc) global.gc();
    const start = process.hrtime.bigint();
    let error = null;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ms, error };
  }

  test('2,000 unknown top-level keys of 50,000 characters each: fast, one too-many-fields error, bounded message', () => {
    const doc = { title: 't', nodes: [], edges: [] };
    for (let i = 0; i < 2000; i++) {
      doc[`x${i}${'y'.repeat(50000)}`] = true;
    }
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-fields']);
    assert.strictEqual(error.errors[0].path, '');
    assert.ok(error.message.length < 2000, `summary message was ${error.message.length} chars`);
  });

  test('2,000 unknown keys of 50,000 characters each on a single node: fast, one too-many-fields error at that node', () => {
    const node = { id: 'n1', label: 'N', kind: 'service' };
    for (let i = 0; i < 2000; i++) {
      node[`x${i}${'y'.repeat(50000)}`] = true;
    }
    const doc = { title: 't', nodes: [node], edges: [] };
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-fields']);
    assert.strictEqual(error.errors[0].path, '/nodes/0');
    assert.ok(error.message.length < 2000);
  });

  test('50,000 nodes: fast, exactly one too-many-nodes error, no per-item validation runs', () => {
    const nodes = Array.from({ length: 50000 }, (_, i) => ({ id: `n${i}`, label: 'N', kind: 'service' }));
    const doc = { title: 't', nodes, edges: [] };
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-nodes']);
    assert.ok(error.message.length < 2000);
  });

  test('200,000 edges: fast, exactly one too-many-edges error', () => {
    const doc = {
      title: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: Array.from({ length: 200000 }, () => ({ from: 'a', to: 'b', type: 'solid', condition: null })),
    };
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-edges']);
    assert.ok(error.message.length < 2000);
  });

  test('50,000 nodes each with an invalid kind: fast, still exactly one too-many-nodes error (not 100,001)', () => {
    const nodes = Array.from({ length: 50000 }, (_, i) => ({ id: `n${i}`, label: 'N', kind: 'bogus' }));
    const doc = { title: 't', nodes, edges: [] };
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-nodes']);
    assert.ok(error.message.length < 2000);
  });

  test('one object with 10,000 keys: fast, one too-many-fields error, no per-key hint computation', () => {
    const doc = { title: 't', nodes: [], edges: [] };
    for (let i = 0; i < 10000; i++) doc[`field${i}`] = true;
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.deepStrictEqual(error.errors.map(e => e.code), ['too-many-fields']);
    assert.ok(error.message.length < 2000);
  });

  test('a document producing well over 100 real errors is capped at 101 entries, with a too-many-errors sentinel last', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: 'N', kind: 'bogus' }));
    const edges = Array.from({ length: 400 }, (_, i) => ({ from: `n${i % 100}`, to: `n${(i + 1) % 100}`, type: 'bogus', condition: null }));
    const doc = { title: 't', nodes, edges };
    const { ms, error } = timed(() => validateDoc(doc));
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    assert.ok(error instanceof ValidationError);
    assert.ok(error.errors.length <= 101, `expected at most 101 errors, got ${error.errors.length}`);
    const last = error.errors[error.errors.length - 1];
    assert.strictEqual(last.code, 'too-many-errors');
    assert.match(last.message, /more errors not shown/);
    assert.ok(error.message.length < 2000, `summary message was ${error.message.length} chars`);
  });

  test('a "did you mean" hint is never computed for a key over 40 characters (no hint offered)', () => {
    const doc = baseDoc();
    doc.nodes[0][`sublabel_but_way_too_long_to_be_a_typo_${'z'.repeat(20)}`] = 'x';
    const err = invalid(doc);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.ok(!/did you mean/i.test(e.message), 'a key over 40 chars should not get a hint');
  });

  test('a 100,000-character unknown key is truncated to 60 chars with an ellipsis in both the message and the path', () => {
    const doc = baseDoc();
    const hugeKey = 'z'.repeat(100000);
    doc.nodes[0][hugeKey] = 'x';
    const start = process.hrtime.bigint();
    const err = invalid(doc);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < TIME_BOUND_MS, `took ${ms.toFixed(1)}ms, expected under ${TIME_BOUND_MS}ms`);
    const e = err.errors.find(x => x.code === 'unknown-field');
    assert.ok(e);
    assert.ok(e.message.length < 200, `message should be short, was ${e.message.length} chars`);
    assert.ok(e.message.includes('…'), 'message should carry the truncation ellipsis');
    assert.ok(e.path.length < 200, `path should be short, was ${e.path.length} chars`);
    assert.ok(e.path.includes('…'), 'path segment should carry the truncation ellipsis');
  });

  test('a huge id/sublabel/condition/attachTo value echoed into a message is truncated to 60 chars', () => {
    // invalid id (too long to match ID_RE) — echoed value must be capped.
    const idDoc = baseDoc();
    idDoc.nodes[0].id = 'n'.repeat(5000);
    idDoc.edges[0].from = 'n'.repeat(5000);
    const idErr = invalid(idDoc);
    const idErrorEntry = idErr.errors.find(x => x.code === 'invalid-id');
    assert.ok(idErrorEntry);
    assert.ok(idErrorEntry.message.length < 200, `id message was ${idErrorEntry.message.length} chars`);
    assert.ok(idErrorEntry.message.includes('…'));

    // sublabel echoed in sublabel-too-many-words.
    const subDoc = baseDoc();
    subDoc.nodes[0].sublabel = `${'word '.repeat(5000).trim()}`;
    const subErr = invalid(subDoc);
    const subErrorEntry = subErr.errors.find(x => x.code === 'sublabel-too-many-words');
    assert.ok(subErrorEntry);
    assert.ok(subErrorEntry.message.length < 300, `sublabel message was ${subErrorEntry.message.length} chars`);
    assert.ok(subErrorEntry.message.includes('…'));

    // condition echoed in condition-requires-dashed via edge.type mismatch text.
    const condDoc = baseDoc();
    condDoc.edges[0].type = 'x'.repeat(5000); // invalid type, also exercises invalid-type path
    condDoc.edges[0].condition = 'y'.repeat(5000);
    const condErr = invalid(condDoc);
    const condRequiresDashed = condErr.errors.find(x => x.code === 'condition-requires-dashed');
    assert.ok(condRequiresDashed);
    assert.ok(condRequiresDashed.message.length < 300);

    // attachTo target echoed in unknown-attach-target.
    const noteDoc = baseDoc({ notes: [{ id: 'note1', content: 'hi', attachTo: ['z'.repeat(5000)] }] });
    const noteErr = invalid(noteDoc);
    const attachErr = noteErr.errors.find(x => x.code === 'unknown-attach-target');
    assert.ok(attachErr);
    assert.ok(attachErr.message.length < 300, `attachTo message was ${attachErr.message.length} chars`);
    assert.ok(attachErr.message.includes('…'));
  });

  test('exactly 100 nodes, 500 edges, 50 groups, 20 notes, and 50 tour entries are still accepted (boundary, not capped)', () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, label: `G${i}` }));
    const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service', parentId: `g${i % 50}` }));
    const edges = Array.from({ length: 500 }, (_, i) => ({ from: `n${i % 100}`, to: `n${(i + 1) % 100}`, type: 'solid', condition: null }));
    const notes = Array.from({ length: 20 }, (_, i) => ({ id: `note${i}`, content: `note ${i}` }));
    const tour = Array.from({ length: 50 }, (_, i) => ({ order: i + 1, title: `Step ${i}`, description: 'D', nodeIds: [`n${i}`] }));
    const doc = { title: 't', groups, nodes, edges, notes, tour };
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('501 edges, 51 groups, or 51 tour entries each trip exactly one cap error', () => {
    const tooManyEdges = {
      title: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'service' },
        { id: 'b', label: 'B', kind: 'service' },
      ],
      edges: Array.from({ length: 501 }, () => ({ from: 'a', to: 'b', type: 'solid', condition: null })),
    };
    const edgesErr = invalid(tooManyEdges);
    assert.deepStrictEqual(codesOf(edgesErr), ['too-many-edges']);

    const tooManyGroups = {
      title: 't',
      groups: Array.from({ length: 51 }, (_, i) => ({ id: `g${i}`, label: `G${i}` })),
      nodes: [{ id: 'a', label: 'A', kind: 'service' }],
      edges: [],
    };
    const groupsErr = invalid(tooManyGroups);
    assert.deepStrictEqual(codesOf(groupsErr), ['too-many-groups']);

    const tooManyTour = {
      title: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'service' }],
      edges: [],
      tour: Array.from({ length: 51 }, (_, i) => ({ order: i + 1, title: `T${i}`, description: 'D', nodeIds: ['a'] })),
    };
    const tourErr = invalid(tooManyTour);
    assert.deepStrictEqual(codesOf(tourErr), ['too-many-tour-entries']);
  });
});

// ---------------------------------------------------------------------
// Details card fields: node.description, node.link, edge.description
// (docs/design/n8n-visual-style.md "Details card").
// ---------------------------------------------------------------------

describe('node.description', () => {
  test('a valid description is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].description = 'Handles inbound webhook requests for this system.';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('line breaks are kept, not rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].description = 'Line one.\nLine two.';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a whitespace-only description is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].description = '   ';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-description']);
  });

  test('a description over 280 characters is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].description = 'x'.repeat(281);
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['description-too-long']);
  });

  test('exactly 280 characters is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].description = 'x'.repeat(280);
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a non-string description is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].description = 42;
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-description']);
  });
});

describe('node.link', () => {
  test('a valid https link is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://docs.example.com/guide';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a valid http link is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'http://internal.example.com/wiki';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a javascript: link is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'javascript:alert(1)';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a data: link is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'data:text/html,<script>alert(1)</script>';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a link containing whitespace is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://example.com/a b';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a link containing a quote is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://example.com/"onmouseover="x';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a link containing an angle bracket is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://example.com/<script>';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a protocol-relative link is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = '//evil.example.com/x';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a schemeless-authority link ("https:evil.com", no //) is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https:evil.com';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a single-slash link ("http:/x") is rejected', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'http:/x';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-link']);
  });

  test('a link over 300 characters is rejected as link-too-long, not invalid-link', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://example.com/' + 'x'.repeat(281);
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['link-too-long']);
  });

  test('exactly 300 characters is accepted', () => {
    const doc = baseDoc();
    doc.nodes[0].link = 'https://example.com/' + 'x'.repeat(280);
    assert.strictEqual(doc.nodes[0].link.length, 300);
    assert.doesNotThrow(() => validateDoc(doc));
  });
});

describe('edge.description', () => {
  test('a valid edge description is accepted', () => {
    const doc = baseDoc();
    doc.edges[0].description = 'Refund amount and the original payment intent id';
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('a whitespace-only edge description is rejected', () => {
    const doc = baseDoc();
    doc.edges[0].description = '   ';
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['invalid-description']);
  });

  test('an edge description over 200 characters is rejected', () => {
    const doc = baseDoc();
    doc.edges[0].description = 'x'.repeat(201);
    const err = invalid(doc);
    assert.deepStrictEqual(codesOf(err), ['description-too-long']);
  });

  test('exactly 200 characters is accepted', () => {
    const doc = baseDoc();
    doc.edges[0].description = 'x'.repeat(200);
    assert.doesNotThrow(() => validateDoc(doc));
  });
});
