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

  test('status open/confirmed/suggested(with rationale) all validate', () => {
    for (const status of ['open', 'confirmed']) {
      const doc = baseDoc();
      doc.nodes[0].status = status;
      assert.doesNotThrow(() => validateDoc(doc), `status ${status} should validate`);
    }
    const suggestedDoc = baseDoc();
    suggestedDoc.nodes[0].status = 'suggested';
    suggestedDoc.nodes[0].rationale = 'three long-running steps run synchronously';
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
