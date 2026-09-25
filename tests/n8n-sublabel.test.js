// Sublabels wrap rather than being cut (issue #54).
//
// The sublabel is the one line meant to say what a node does. It went
// through truncateLine() and was cut with an ellipsis at every zoom level,
// so the M2 review read "chases unanswered quot…" on the canvas while the
// details card held the full text. Beside a brand icon a cut sublabel reads
// as noise, and on a suggested node it is the only on-canvas explanation of
// the suggestion.
//
// The acceptance criterion from the issue is "every node sublabel renders
// in full on the canvas at fit and 100% zoom". That is a property, not a
// list of examples, so the sweep below asserts it over every schema-legal
// shape rather than over the three strings that happened to be reported.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { wrapSublabel, sublabelReserveExtra, SUBLABEL_WRAP_WIDTH } = require('../src/n8n/sublabel');
const { renderMap } = require('../src/n8n/index');
const {
  NODE_SIZE,
  SUBLABEL_LINE_HEIGHT,
  SUBLABEL_LINES_MAX,
  SUBLABEL_WRAP_PAD,
  LABEL_RESERVE,
} = require('../src/n8n/constants');

const MEDUSA = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'examples', 'medusa-return-flow.json'), 'utf8'),
);

describe('wrapSublabel', () => {
  // The exact strings the M2 review reported (#74), reconstructed from the ellipsised
  // text in the issue. Before the fix these came back as
  // "chases unanswered quot…" and "invoice and reconcilia…".
  const REPORTED = ['chases unanswered quotes', 'invoice and reconciliation', 'Customer confirms booking'];

  test('the three sublabels the issue reported now render in full', () => {
    for (const text of REPORTED) {
      const lines = wrapSublabel(text);
      assert.strictEqual(lines.join(' '), text, `${JSON.stringify(text)} was not rendered in full`);
      assert.ok(lines.length > 1, `${JSON.stringify(text)} should need more than one line`);
    }
  });

  test('no line carries an ellipsis', () => {
    for (const text of REPORTED) {
      assert.ok(!wrapSublabel(text).some(line => line.includes('…')), text);
    }
  });

  test('a sublabel that already fitted stays on one line, unchanged', () => {
    // This is what keeps every existing map byte-identical below the node.
    for (const text of ['sends payment', 'short', 'two words']) {
      assert.deepStrictEqual(wrapSublabel(text), [text]);
    }
  });

  test('empty, missing and whitespace sublabels produce no lines', () => {
    for (const value of [undefined, null, '', 0, false]) {
      assert.deepStrictEqual(wrapSublabel(value), [], JSON.stringify(value));
    }
  });

  test('the wrap width is the node plus the same padding the truncating version used', () => {
    // Kept exactly, so this change is vertical only: no sublabel moves
    // sideways and no column has to be re-measured.
    assert.strictEqual(SUBLABEL_WRAP_WIDTH, NODE_SIZE + SUBLABEL_WRAP_PAD);
    assert.strictEqual(SUBLABEL_WRAP_PAD, 64);
  });

  // The property the issue actually asks for. validate.js caps a sublabel at
  // 3 words and 60 characters; every shape inside that cap must come back
  // whole. A list of examples would pass while leaving the next sublabel to
  // be cut, which is how the bug survived the first time.
  test('no schema-legal sublabel is ever ellipsised', () => {
    let checked = 0;
    const cut = [];
    for (let a = 1; a <= 20; a++) {
      for (let b = 0; b <= 20; b++) {
        for (let c = 0; c <= 20; c++) {
          const words = ['a'.repeat(a)];
          if (b) words.push('b'.repeat(b));
          if (c && b) words.push('c'.repeat(c));
          const text = words.join(' ');
          if (text.length > 60) continue;
          checked++;
          const lines = wrapSublabel(text);
          if (lines.join('').includes('…')) cut.push(text);
          if (lines.length > SUBLABEL_LINES_MAX) cut.push(`${text} (${lines.length} lines)`);
        }
      }
    }
    assert.ok(checked > 8000, `expected a broad sweep, checked only ${checked}`);
    assert.deepStrictEqual(cut.slice(0, 5), [], `${cut.length} schema-legal sublabels were cut`);
  });

  test('a single unbreakable word longer than the line still overflows, as a label does', () => {
    // Stated rather than fixed. wrapLabel does not hyphenate, and inventing
    // a break here would make the sublabel the only text in the product
    // that does. It is also unreachable through the schema's word cap in
    // any realistic map.
    const lines = wrapSublabel('x'.repeat(58));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], 'x'.repeat(58));
  });
});

describe('sublabelReserveExtra', () => {
  test('a map whose sublabels all fit reserves nothing extra', () => {
    // This is what guarantees no existing layout moves.
    assert.strictEqual(sublabelReserveExtra([{ sublabel: 'short' }, { sublabel: 'two words' }]), 0);
    assert.strictEqual(sublabelReserveExtra([]), 0);
    assert.strictEqual(sublabelReserveExtra(undefined), 0);
  });

  test('nodes with no sublabel at all cost nothing', () => {
    assert.strictEqual(sublabelReserveExtra([{ label: 'A' }, { label: 'B' }]), 0);
  });

  test('a two-line sublabel reserves exactly one extra line', () => {
    assert.strictEqual(
      sublabelReserveExtra([{ sublabel: 'invoice and reconciliation' }]),
      SUBLABEL_LINE_HEIGHT,
    );
  });

  test('the tallest sublabel sets the reserve for every node', () => {
    // One number applied uniformly, matching how LABEL_RESERVE is itself one
    // constant shared by every node (captions.js takes the same approach).
    const nodes = [
      { sublabel: 'short' },
      { sublabel: 'invoice and reconciliation' },
      { sublabel: 'also short' },
    ];
    assert.strictEqual(sublabelReserveExtra(nodes), SUBLABEL_LINE_HEIGHT);
  });

  test('the Medusa fixture reserves nothing extra', () => {
    // Which is why the golden rebaseline for this change is markup only:
    // the layout input is identical and nothing on the canvas moved.
    assert.strictEqual(sublabelReserveExtra(MEDUSA.nodes), 0);
  });
});

describe('the rendered canvas', () => {
  // A map with one node whose sublabel needs two lines, so the whole path --
  // wrap, reserve, markup -- is exercised end to end rather than unit by
  // unit.
  function docWithLongSublabel() {
    return {
      title: 'Sublabel wrapping',
      nodes: [
        { id: 'a', label: 'Quote sent', kind: 'service', sublabel: 'chases unanswered quotes' },
        { id: 'b', label: 'Paid', kind: 'artifact' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'solid' }],
    };
  }

  test('both wrapped lines reach the SVG, and neither is cut', async () => {
    const html = await renderMap(docWithLongSublabel());
    const block = html.match(/<text class="node-sublabel"[\s\S]*?<\/text>/);
    assert.ok(block, 'no sublabel was rendered');
    assert.match(block[0], />chases unanswered</);
    assert.match(block[0], />quotes</);
    assert.ok(!block[0].includes('…'), 'the sublabel was still cut');
  });

  test('the two lines sit one line-height apart', async () => {
    const html = await renderMap(docWithLongSublabel());
    const ys = [...html.matchAll(/<text class="node-sublabel"[^>]*>([\s\S]*?)<\/text>/g)]
      .flatMap(m => [...m[1].matchAll(/y="([\d.-]+)"/g)].map(y => Number(y[1])));
    assert.strictEqual(ys.length, 2);
    assert.strictEqual(ys[1] - ys[0], SUBLABEL_LINE_HEIGHT);
  });

  test('a one-line sublabel still renders as a single tspan', async () => {
    const doc = docWithLongSublabel();
    doc.nodes[0].sublabel = 'short';
    const html = await renderMap(doc);
    const block = html.match(/<text class="node-sublabel"[\s\S]*?<\/text>/);
    assert.strictEqual((block[0].match(/<tspan/g) || []).length, 1);
  });

  test('a hostile sublabel is escaped on every line', async () => {
    const doc = docWithLongSublabel();
    doc.nodes[0].sublabel = '<script>alert</script> x';
    const html = await renderMap(doc);
    const block = html.match(/<text class="node-sublabel"[\s\S]*?<\/text>/);
    assert.ok(block, 'no sublabel was rendered');
    assert.ok(!block[0].includes('<script>'), 'markup reached the canvas unescaped');
    assert.match(block[0], /&lt;script&gt;/);
  });

  test('the reserve constant still assumes exactly one sublabel line', () => {
    // sublabelReserveExtra only pays for the lines PAST the first, so this
    // is the assumption it rests on. If LABEL_RESERVE is ever retuned, the
    // extra has to be re-derived with it.
    assert.strictEqual(LABEL_RESERVE, 48);
  });
});

// The documentation export follows the same rule. It is the one output
// with no hover card at all, so a sublabel cut there loses its meaning for
// good -- the canvas at least keeps the full text in the details card.
describe('the documentation export', () => {
  const { renderSvg } = require('../src/n8n/index');
  const doc = () => ({
    title: 'Sublabel wrapping',
    nodes: [
      {
        id: 'a',
        label: 'Quote sent',
        kind: 'service',
        sublabel: 'chases unanswered quotes',
        description: 'Sends the reminder and records the reply.',
      },
      { id: 'b', label: 'Paid', kind: 'artifact' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
  });

  test('a long sublabel is wrapped in full, not cut', async () => {
    const svg = await renderSvg(doc());
    const block = svg.match(/<text text-anchor="middle" font-size="13"[^>]*>([\s\S]*?)<\/text>/);
    assert.ok(block, 'no sublabel in the figure');
    assert.match(block[1], />chases unanswered</);
    assert.match(block[1], />quotes</);
    assert.ok(!svg.includes('…'), 'something in the figure was cut');
  });

  test('the caption starts below the last sublabel line, not over it', async () => {
    const svg = await renderSvg(doc());
    const sub = svg.match(/<text text-anchor="middle" font-size="13"[^>]*>([\s\S]*?)<\/text>/)[1];
    const subYs = [...sub.matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]));
    const capY = Number(svg.match(/font-size="12"[^>]*><tspan[^>]*y="([\d.]+)"/)[1]);
    assert.ok(capY > subYs[subYs.length - 1], `caption at ${capY}, last sublabel line at ${subYs[subYs.length - 1]}`);
  });
});
