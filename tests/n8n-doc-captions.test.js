// CTO-M1-03 regression: the documentation export must not truncate what it
// is for. The figure is made for slides, PDFs and pasted screenshots where
// nobody can hover, so a caption cut off at "Owns shipment state, including
// the…" tells the reader strictly less than the node's own label already
// did. Before the fix the Medusa business export contained 33 ellipsis
// characters: all 29 node captions and all 4 edge labels were cut.
//
// These assertions are measurements of the generated SVG, not eyeballing:
// count the ellipses, and check the wrapped lines reassemble into exactly
// the text that went in.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderSvg, validateDoc } = require('../src/n8n/index');
const { buildDocSvg } = require('../src/n8n/render-doc');
const { filterDocForLayers } = require('../src/n8n/doc-filter');
const { wrapCaption, CAPTION_WRAP_WIDTH } = require('../src/n8n/captions');
const { wrapEdgeText } = require('../src/n8n/edge-text');
const { wrapParagraph } = require('../src/n8n/geometry');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const medusaDoc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// The doc-map skill drafts descriptions of "at most 12 words" for nodes
// that have none (skills/doc-map/SKILL.md). That is the length the product
// itself produces, so it is the length the export has to be able to print.
const TWELVE_WORD_DESCRIPTION = 'Receives the returned parcel and records which items actually arrived back';

function countEllipses(svg) {
  return (svg.match(/…/g) || []).length;
}

describe('CTO-M1-03: the documentation export never truncates a caption', () => {
  test('the Medusa business export contains no ellipsis at all (was 33)', async () => {
    const svg = await renderSvg(medusaDoc, { layers: ['business'] });
    assert.strictEqual(countEllipses(svg), 0);
  });

  test('no layer combination of the Medusa export truncates anything', async () => {
    for (const layers of [[], ['business'], ['edge'], ['business', 'edge', 'build']]) {
      const svg = await renderSvg(medusaDoc, { layers });
      assert.strictEqual(countEllipses(svg), 0, `layers=${JSON.stringify(layers)} truncated something`);
    }
  });

  test('every Medusa node description survives wrapping word for word', () => {
    const descriptions = medusaDoc.nodes.map(n => n.description).filter(Boolean);
    assert.ok(descriptions.length >= 40, 'fixture should still carry the descriptions this guards');
    const lossy = descriptions.filter(d => wrapCaption(d).join(' ') !== d);
    assert.deepStrictEqual(lossy, [], 'these descriptions did not survive wrapping intact');
  });

  test("every node's caption text is actually present in the rendered SVG", async () => {
    const svg = await renderSvg(medusaDoc, { layers: ['business'] });
    const filtered = filterDocForLayers(validateDoc(medusaDoc), ['business']);
    const missing = [];
    filtered.nodes.forEach(n => {
      if (!n.description) return;
      wrapCaption(n.description).forEach(line => {
        // Caption lines are plain text with no escapable characters in
        // this fixture, so they appear verbatim as tspan content.
        if (!svg.includes(`>${line}</tspan>`)) missing.push(`${n.id}: ${line}`);
      });
    });
    assert.deepStrictEqual(missing, []);
  });

  test('a 12-word description — the length the doc-map skill drafts — renders in full', async () => {
    const doc = JSON.parse(JSON.stringify(medusaDoc));
    doc.nodes[0].description = TWELVE_WORD_DESCRIPTION;
    const svg = await renderSvg(doc, { layers: ['business'] });
    assert.strictEqual(countEllipses(svg), 0);
    const lines = wrapCaption(TWELVE_WORD_DESCRIPTION);
    assert.strictEqual(lines.join(' '), TWELVE_WORD_DESCRIPTION);
    lines.forEach(line => assert.ok(svg.includes(`>${line}</tspan>`), `missing caption line: ${line}`));
  });

  test('a description at the schema maximum (280 characters) still is not truncated', () => {
    const maxLength = `${'word '.repeat(55)}end`.slice(0, 280).trim();
    const lines = wrapCaption(maxLength);
    assert.ok(!lines.some(l => l.includes('…')));
    assert.strictEqual(lines.join(' '), maxLength);
  });

  test('an unbreakable 280-character run is hard-broken instead of overflowing its column', () => {
    const lines = wrapCaption('D'.repeat(280));
    assert.ok(lines.length > 1, 'a word wider than the column must be split across lines');
    assert.strictEqual(lines.join(''), 'D'.repeat(280));
  });
});

describe('CTO-M1-03: edge labels are printed in full too', () => {
  test('a ~40-character edge label survives intact', () => {
    const label = 'Return id and the items approved for re'; // 39 chars, the case the CTO cited
    const lines = wrapEdgeText(label);
    assert.ok(!lines.some(l => l.includes('…')));
    assert.strictEqual(lines.join(' '), label);
  });

  test('every Medusa edge description and condition survives wrapping', () => {
    const texts = medusaDoc.edges.map(e => e.description || e.condition).filter(Boolean);
    assert.ok(texts.length > 0);
    const lossy = texts.filter(t => wrapEdgeText(t).join(' ') !== t);
    assert.deepStrictEqual(lossy, [], 'these edge labels did not survive wrapping intact');
  });

  test('an edge description at the schema maximum (200 characters) is not truncated', () => {
    const maxLength = `${'word '.repeat(40)}end`.slice(0, 200).trim();
    assert.strictEqual(wrapEdgeText(maxLength).join(' '), maxLength);
  });
});

describe('CTO-M1-03: the wider caption column still cannot collide', () => {
  test('two nodes sharing a row are always further apart than a caption is wide', async () => {
    const { layout } = await buildDocSvg(medusaDoc, { layers: ['business'] });
    const boxes = Object.entries(layout.nodeBoxes).map(([id, b]) => ({ id, ...b }));
    const tooClose = [];
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id >= b.id) continue;
        const verticallyOverlapping = a.y < b.y + b.h && b.y < a.y + a.h;
        if (!verticallyOverlapping) continue;
        const centreDistance = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        if (centreDistance < CAPTION_WRAP_WIDTH) tooClose.push(`${a.id}/${b.id} ${centreDistance}px`);
      }
    }
    assert.deepStrictEqual(tooClose, [], 'captions this close would overlap each other');
  });
});

describe('wrapParagraph (the wrap behind both)', () => {
  test('short text stays on one line and is untouched', () => {
    assert.deepStrictEqual(wrapParagraph('Short one', 176, 16, 12), ['Short one']);
  });

  test('only past maxLines does an ellipsis appear at all', () => {
    const lines = wrapParagraph('word '.repeat(200).trim(), 176, 3, 12);
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[2].endsWith('…'), 'the ceiling still degrades gracefully rather than overflowing');
  });
});
