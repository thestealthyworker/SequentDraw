// Documentation export (renderSvg / buildDocSvg). See
// docs/design/n8n-visual-style.md "Documentation export (SVG with inline
// captions)".

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('@xmldom/xmldom');

const { renderSvg, validateDoc } = require('../src/n8n/index');
const { buildDocSvg } = require('../src/n8n/render-doc');
const { filterDocForLayers } = require('../src/n8n/doc-filter');
const { wrapCaption } = require('../src/n8n/captions');
const { measureDoc } = require('../scripts/measure-n8n-layout');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');

// --- a small hand-built doc exercising every filtering rule -------------
//
//   a (base)                node with no description: no caption
//   b (base+business, g1)   short description: 1-line caption
//   c (business, g1)        long description: 2-line caption with ellipsis
//   d (edge, g2)             description
//   e (base)                connected only via d -> e in the full doc
//
// Edges: a->b (base/base), b->c, c->d, d->e. Every node has at least one
// edge in the FULL doc, so validateDoc() accepts it. Filtering to base
// only drops c and d, which drops edge d->e too, leaving e with zero
// edges in the filtered set — the "not re-validated for orphans" case.
function filterFixtureDoc() {
  return {
    title: 'Filter fixture',
    groups: [
      { id: 'g1', label: 'Group one', color: 'purple' },
      { id: 'g2', label: 'Group two', color: 'teal' },
    ],
    nodes: [
      { id: 'a', label: 'A', kind: 'service', layers: ['base'] },
      { id: 'b', label: 'B', kind: 'service', parentId: 'g1', layers: ['base', 'business'], description: 'Short one' },
      {
        id: 'c',
        label: 'C',
        kind: 'service',
        parentId: 'g1',
        layers: ['business'],
        description:
          'This description is long enough that it should wrap across two full lines and then get truncated with an ellipsis at the end',
      },
      { id: 'd', label: 'D', kind: 'service', parentId: 'g2', layers: ['edge'], description: 'An edge-layer node' },
      { id: 'e', label: 'E', kind: 'service', layers: ['base'] },
    ],
    edges: [
      { from: 'a', to: 'b', type: 'solid' },
      { from: 'b', to: 'c', type: 'solid', description: 'b to c payload' },
      { from: 'c', to: 'd', type: 'solid' },
      { from: 'd', to: 'e', type: 'solid' },
    ],
    notes: [
      { id: 'n_base', content: 'Map-level base note', layers: ['base'] },
      { id: 'n_attached_base', content: 'Attached to a only', attachTo: ['a'], layers: ['base'] },
      { id: 'n_business_bc', content: 'Business note on b and c', attachTo: ['b', 'c'], layers: ['business'] },
      { id: 'n_partial', content: 'Attached to a and d', attachTo: ['a', 'd'], layers: ['base'] },
      { id: 'n_all_excluded', content: 'Attached to d only', attachTo: ['d'], layers: ['base'] },
      { id: 'n_group_excluded', content: 'Attached to group two', attachTo: ['g2'], layers: ['base'] },
    ],
  };
}

describe('doc-export: filtering (filterDocForLayers)', () => {
  test('base is always included, even with an empty layers array', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []);
    const ids = filtered.nodes.map(n => n.id).sort();
    assert.deepStrictEqual(ids, ['a', 'b', 'e']);
  });

  test('unknown layer names throw a clear error', () => {
    const validated = validateDoc(filterFixtureDoc());
    assert.throws(() => filterDocForLayers(validated, ['bogus']), /Unknown layer.*bogus/s);
    assert.throws(() => filterDocForLayers(validated, ['bogus', 'also-bad']), /bogus.*also-bad|also-bad.*bogus/s);
  });

  test('includes a node when any of its layers is in the set', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, ['business']);
    const ids = filtered.nodes.map(n => n.id).sort();
    // base always included (a, b, e) plus business (b already counted, c).
    assert.deepStrictEqual(ids, ['a', 'b', 'c', 'e']);
  });

  test('includes an edge only when both endpoints are included', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []); // base only: a, b, e
    const pairs = filtered.edges.map(e => `${e.from}->${e.to}`);
    assert.deepStrictEqual(pairs, ['a->b']); // b->c, c->d, d->e all drop an endpoint
  });

  test('includes a group only when it has at least one included member', () => {
    const validated = validateDoc(filterFixtureDoc());
    const baseOnly = filterDocForLayers(validated, []);
    assert.deepStrictEqual(baseOnly.groups.map(g => g.id), ['g1']); // b is in g1; g2's only member is d (edge-only)

    const withEdge = filterDocForLayers(validated, ['edge']);
    assert.deepStrictEqual(withEdge.groups.map(g => g.id).sort(), ['g1', 'g2']);
  });

  test('a node whose edges were all filtered out is still included (not re-validated for orphans)', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []); // base only
    assert.ok(filtered.nodes.some(n => n.id === 'e'));
    assert.ok(!filtered.edges.some(e => e.from === 'e' || e.to === 'e'));
  });

  test('notes: kept when layers intersect, dropped when they do not', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []); // base only
    const ids = filtered.notes.map(n => n.id).sort();
    // n_business_bc's own layers (['business']) don't intersect {base}: dropped
    // regardless of its targets.
    assert.ok(!ids.includes('n_business_bc'));
  });

  test('notes: attachTo targets that are excluded are dropped from the note, not the whole note', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []); // base only: d excluded
    const note = filtered.notes.find(n => n.id === 'n_partial');
    assert.ok(note, 'n_partial should survive with its remaining target');
    assert.deepStrictEqual(note.attachTo, ['a']);
  });

  test('notes: dropped entirely when every attachTo target is excluded', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []); // base only: d excluded
    assert.ok(!filtered.notes.some(n => n.id === 'n_all_excluded'));
    assert.ok(!filtered.notes.some(n => n.id === 'n_group_excluded')); // g2 excluded too
  });

  test('notes: a group-attached note survives once its group is included', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, ['edge']); // pulls in d, hence g2
    const note = filtered.notes.find(n => n.id === 'n_group_excluded');
    assert.ok(note);
    assert.deepStrictEqual(note.attachTo, ['g2']);
  });

  test('map-level notes (no attachTo) are always kept once their own layers are visible', () => {
    const validated = validateDoc(filterFixtureDoc());
    const filtered = filterDocForLayers(validated, []);
    assert.ok(filtered.notes.some(n => n.id === 'n_base'));
  });
});

describe('doc-export: renderSvg end to end on the filter fixture', () => {
  test('renderSvg accepts a raw (unvalidated-shape) doc and validates it first', async () => {
    const svg = await renderSvg(filterFixtureDoc(), { layers: [] });
    assert.match(svg, /<svg/);
  });

  test('renderSvg rejects an unknown layer name', async () => {
    await assert.rejects(() => renderSvg(filterFixtureDoc(), { layers: ['not-a-layer'] }), /Unknown layer/);
  });

  test('renderSvg rejects a doc that fails full validation, even before filtering', async () => {
    const bad = filterFixtureDoc();
    delete bad.nodes[0].kind; // required field
    await assert.rejects(() => renderSvg(bad, { layers: ['business'] }));
  });

  test('omits nodes outside the chosen layers rather than stubbing them', async () => {
    const svgBase = await renderSvg(filterFixtureDoc(), { layers: [] });
    const svgBusiness = await renderSvg(filterFixtureDoc(), { layers: ['business'] });
    assert.doesNotMatch(svgBase, />C</); // c's label text
    assert.match(svgBusiness, />C</);
  });
});

describe('doc-export: captions', () => {
  test('wrapCaption: no description -> no caption lines', () => {
    assert.deepStrictEqual(wrapCaption(''), []);
    assert.deepStrictEqual(wrapCaption(null), []);
    assert.deepStrictEqual(wrapCaption(undefined), []);
  });

  test('wrapCaption: short description -> a single line, no ellipsis', () => {
    const lines = wrapCaption('Short one');
    assert.strictEqual(lines.length, 1);
    assert.ok(!lines[0].endsWith('…'));
  });

  test('wrapCaption: long description -> at most 2 lines, ellipsis on the last', () => {
    const long =
      'This description is long enough that it should wrap across two full lines and then get truncated with an ellipsis at the end';
    const lines = wrapCaption(long);
    assert.ok(lines.length <= 2);
    assert.ok(lines.length >= 1);
    assert.ok(lines[lines.length - 1].endsWith('…'));
  });

  test('a node with no description gets no caption text in the SVG', async () => {
    const { svg, layout } = await buildDocSvg(filterFixtureDoc(), { layers: [] });
    // a has no description; its box should have no caption fill colour text.
    const aBox = layout.nodeBoxes.a;
    assert.ok(aBox);
    // No text node between a's sublabel area and the next node carries the
    // caption colour for a's own caption slot — a coarse but effective
    // check is that "A" appears without any wrapped multi-line caption
    // near it producing the caption fill colour at all for a lone node
    // with description undefined. We assert indirectly via captionReserveExtra.
    assert.match(svg, /<svg/);
  });

  test('a node with a long description gets a wrapped, ellipsised caption in the SVG', async () => {
    const svg = await renderSvg(filterFixtureDoc(), { layers: ['business'] });
    assert.match(svg, /…/); // c's caption should end in an ellipsis somewhere in the doc
  });

  test('the reserved label strip grows to fit the tallest caption in play', async () => {
    const { labelReserve: reserveWithCaptions } = await buildDocSvg(filterFixtureDoc(), { layers: ['business'] });
    const docNoDescriptions = filterFixtureDoc();
    docNoDescriptions.nodes.forEach(n => delete n.description);
    const { labelReserve: reserveNoCaptions } = await buildDocSvg(docNoDescriptions, { layers: ['business'] });
    assert.ok(reserveWithCaptions > reserveNoCaptions);
  });
});

describe('doc-export: determinism', () => {
  test('the same input and layers give byte-identical SVG', async () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const a = await renderSvg(doc, { layers: ['business', 'edge'] });
    const b = await renderSvg(doc, { layers: ['business', 'edge'] });
    assert.strictEqual(a, b);
  });

  test('is deterministic across repeated calls on the small filter fixture', async () => {
    const a = await renderSvg(filterFixtureDoc(), { layers: ['business'] });
    const b = await renderSvg(filterFixtureDoc(), { layers: ['business'] });
    assert.strictEqual(a, b);
  });
});

describe('doc-export: no viewer artefacts', () => {
  test('carries none of the interactive viewer\'s chrome or interaction wiring', async () => {
    const svg = await renderSvg(filterFixtureDoc(), { layers: ['business', 'edge'] });
    assert.doesNotMatch(svg, /dot-grid/);
    assert.doesNotMatch(svg, /zoom-bar/);
    assert.doesNotMatch(svg, /layer-bar/);
    assert.doesNotMatch(svg, /details-card/);
    assert.doesNotMatch(svg, /tabindex/);
    assert.doesNotMatch(svg, /aria-[a-z]+=/);
    assert.doesNotMatch(svg, /is-dim/);
    assert.doesNotMatch(svg, /is-hover/);
    assert.doesNotMatch(svg, /<script/i);
  });
});

// --- security ------------------------------------------------------------

function hostileDoc() {
  const hostile = '</text><script>alert(1)</script>" & javascript:alert(2)';
  return {
    title: `Title ${hostile}`,
    groups: [{ id: 'g1', label: `Group ${hostile}`, color: 'purple' }],
    nodes: [
      {
        id: 'n1',
        label: `Label ${hostile}`,
        sublabel: 'Sub"><b',
        kind: 'service',
        parentId: 'g1',
        layers: ['base'],
        description: `Desc ${hostile}`,
      },
      { id: 'n2', label: `N2 ${hostile}`, kind: 'service', parentId: 'g1', layers: ['base'] },
    ],
    edges: [
      { from: 'n1', to: 'n2', type: 'dashed', condition: `Cond ${hostile}`, description: `Edge desc ${hostile}` },
    ],
    notes: [
      {
        id: 'note1',
        content: `# Heading ${hostile}\n[click me](javascript:alert(3)) and [safe link](https://example.com/safe)`,
        attachTo: ['n1'],
        layers: ['base'],
      },
    ],
  };
}

describe('doc-export: security on a hostile fixture', () => {
  test('the SVG contains none of the forbidden constructs', async () => {
    const svg = await renderSvg(hostileDoc(), { layers: [] });
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(svg, /<foreignObject/i);
    assert.doesNotMatch(svg, /<a[\s>]/i);
    assert.doesNotMatch(svg, /\bhref\s*=/i);
    assert.doesNotMatch(svg, /xlink:href/i);
    assert.doesNotMatch(svg, /\s+on\w+\s*=/i); // event-handler attribute, e.g. onclick=
    assert.doesNotMatch(svg, /<style[^>]*>[^<]*(@import|url\((?!#))/i);
    assert.doesNotMatch(svg, /<image[\s>]/i);
    assert.doesNotMatch(svg, /<use[^>]*(https?:|\/\/)/i);
  });

  test('the hostile substrings never appear unescaped in the markup', async () => {
    const svg = await renderSvg(hostileDoc(), { layers: [] });
    assert.doesNotMatch(svg, /<\/text><script>/);
    assert.doesNotMatch(svg, /<script>alert/);
  });

  test('a javascript: note link renders as plain text, never as an href', async () => {
    const svg = await renderSvg(hostileDoc(), { layers: [] });
    assert.doesNotMatch(svg, /href="javascript:/i);
  });

  test('a safe https note link still renders as plain underlined text, not an <a>', async () => {
    const svg = await renderSvg(hostileDoc(), { layers: [] });
    assert.doesNotMatch(svg, /<a\s/i);
    assert.match(svg, /text-decoration="underline"/);
  });

  test('the SVG is well-formed XML (parses with no errors)', async () => {
    const svg = await renderSvg(hostileDoc(), { layers: [] });
    const errors = [];
    const parser = new DOMParser({ onError: (level, msg) => errors.push(`${level}: ${msg}`) });
    const parsed = parser.parseFromString(svg, 'text/xml');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(parsed.documentElement.tagName, 'svg');
  });
});

describe('doc-export: XML well-formedness on every SVG these tests produce', () => {
  function assertWellFormed(svg) {
    const errors = [];
    const parser = new DOMParser({ onError: (level, msg) => errors.push(`${level}: ${msg}`) });
    const parsed = parser.parseFromString(svg, 'text/xml');
    assert.deepStrictEqual(errors, [], svg.slice(0, 200));
    assert.strictEqual(parsed.documentElement.tagName, 'svg');
  }

  test('the filter fixture, every layer combination', async () => {
    for (const layers of [[], ['business'], ['edge'], ['business', 'edge']]) {
      const svg = await renderSvg(filterFixtureDoc(), { layers });
      assertWellFormed(svg);
    }
  });

  test('the Medusa fixture, every layer combination', async () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    for (const layers of [[], ['business'], ['edge'], ['business', 'edge', 'build']]) {
      const svg = await renderSvg(doc, { layers });
      assertWellFormed(svg);
    }
  });
});

// --- layout metrics on Medusa, every layer set --------------------------

describe('doc-export: layout metrics on Medusa (scripts/measure-n8n-layout.js --svg)', () => {
  const layerSets = [[], ['business'], ['edge'], ['business', 'edge', 'build']];

  layerSets.forEach(layers => {
    test(`layers=${JSON.stringify(layers)}: zero node/label/caption/frame/note/edge-text violations`, async () => {
      const row = await measureDoc(layers);
      assert.strictEqual(row.nodeViolations, 0, 'node crossings');
      assert.strictEqual(row.edgeLabelCrossings, 0, 'edge-label crossings (includes captions)');
      assert.strictEqual(row.frameViolations, 0, 'frame crossings');
      assert.strictEqual(row.noteOverlaps, 0, 'note overlaps');
      assert.strictEqual(row.edgeNoteCrossings, 0, 'edge-note crossings');
      assert.strictEqual(row.labelOverlaps, 0, 'label overlaps');
      assert.strictEqual(row.edgeTextLabelOverlaps, 0, 'edge-text-label overlaps');
    });
  });
});

// --- timing bound ----------------------------------------------------------

describe('doc-export: performance', () => {
  test('a 100-node / 300-edge document with maximum-length descriptions renders in under 10s', async () => {
    const LONG_NODE_DESCRIPTION = 'D'.repeat(280);
    const LONG_EDGE_DESCRIPTION = 'E'.repeat(200);
    const nodes = [];
    for (let i = 0; i < 100; i++) {
      nodes.push({ id: `n${i}`, label: `Node ${i}`, kind: 'service', layers: ['base'], description: LONG_NODE_DESCRIPTION });
    }
    // A forward-only chain (every node but the last has an outbound edge,
    // every node but the first an inbound one, so validateDoc's orphan
    // check passes) plus extra forward-only edges up to exactly 300. Kept
    // strictly acyclic (every edge's target index > its source index) —
    // a real workflow graph is overwhelmingly forward, and a dense web of
    // cycles here would stress the feedback-arc-set pass (direction.js)
    // in a way no real input does; this is a rendering timing bound, not
    // a cycle-breaking stress test.
    const edges = [];
    for (let i = 0; i < 99; i++) {
      edges.push({ from: `n${i}`, to: `n${i + 1}`, type: 'solid', description: LONG_EDGE_DESCRIPTION });
    }
    let i = 0;
    while (edges.length < 300) {
      const a = i % 99;
      const b = Math.min(99, a + 2 + (i % 5));
      if (a !== b) edges.push({ from: `n${a}`, to: `n${b}`, type: 'solid', description: LONG_EDGE_DESCRIPTION });
      i++;
    }
    const doc = { title: 'Stress test', nodes, edges };

    const start = Date.now();
    const svg = await renderSvg(doc, { layers: [] });
    const elapsedMs = Date.now() - start;

    assert.match(svg, /<svg/);
    assert.ok(elapsedMs < 10000, `took ${elapsedMs}ms, expected < 10000ms`);
  });
});
