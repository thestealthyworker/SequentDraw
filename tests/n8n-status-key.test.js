// The status key (issue #56, #69): what a dashed "?" node and a
// purple "+" node mean, said on screen without a click, in the figure
// nobody can hover, and in the file the viewer exports. See
// docs/design/n8n-visual-style.md "Status key".
//
// Behaviour that needs a DOM (the counts following the layer toggles, the
// key riding into the exported SVG) was measured in a browser; what is
// asserted here is what the engine emits.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('@xmldom/xmldom');

const { renderMap, renderSvg } = require('../src/n8n/index');
const { statusKeyEntries, statusSwatchMarkup, nodeVisualStyle } = require('../src/n8n/render-svg');
const { statusKeyMarkup } = require('../src/n8n/render');
const { docStatusKeyMarkup } = require('../src/n8n/render-svg-doc');
const { buildDocSvg } = require('../src/n8n/render-doc');
const { DOC_KEY_BLOCK_HEIGHT, OPEN_BORDER, SUGGESTED_BORDER } = require('../src/n8n/constants');

const MEDUSA = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'examples/medusa-return-flow.json'), 'utf8'),
);

// a -> b -> c, where b is an open question on the base layer and c is a
// suggestion on the business layer only, so a business toggle can empty
// one entry without touching the other.
function mixedDoc() {
  return {
    title: 'Key fixture',
    nodes: [
      { id: 'a', label: 'A', kind: 'service' },
      { id: 'b', label: 'Who chases?', kind: 'human', status: 'open', prompt: 'Who chases a silent quote?' },
      {
        id: 'c',
        label: 'Pipedrive',
        kind: 'service',
        status: 'suggested',
        rationale: 'Nobody chases a silent quote.',
        cites: ['b'],
        integration: 'pipedrive',
        layers: ['business'],
      },
      { id: 'd', label: 'D', kind: 'service', status: 'open' },
    ],
    edges: [
      { from: 'a', to: 'b', type: 'solid' },
      { from: 'b', to: 'c', type: 'dashed' },
      { from: 'b', to: 'd', type: 'solid' },
    ],
  };
}

function confirmedDoc() {
  return {
    title: 'Plain fixture',
    nodes: [
      { id: 'a', label: 'A', kind: 'service' },
      { id: 'b', label: 'B', kind: 'service' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
  };
}

function scriptOf(html) {
  return html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
}

function viewBoxOf(svg) {
  return /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
}

describe('statusKeyEntries', () => {
  test('one entry per status present, open before suggested, with counts', () => {
    const entries = statusKeyEntries(mixedDoc().nodes);
    assert.deepStrictEqual(
      entries.map(e => [e.status, e.count]),
      [
        ['open', 2],
        ['suggested', 1],
      ],
    );
  });

  test('nothing when every node is confirmed', () => {
    assert.deepStrictEqual(statusKeyEntries(confirmedDoc().nodes), []);
    assert.deepStrictEqual(statusKeyEntries(MEDUSA.nodes), []);
  });

  test('the entry text says what the style means', () => {
    const [open, suggested] = statusKeyEntries(mixedDoc().nodes);
    assert.strictEqual(open.text, 'Open question');
    assert.strictEqual(suggested.text, 'Suggested, not yet in use');
  });
});

describe('the swatch is a miniature of the node style it explains', () => {
  test('open: dashed, muted fill, a "?" badge in the open border colour', () => {
    const style = nodeVisualStyle({ status: 'open' });
    const svg = statusSwatchMarkup('open', 0, 0, 18);
    assert.match(svg, new RegExp(`fill="${style.fill}"`));
    assert.match(svg, new RegExp(`stroke="${style.color}"`));
    assert.match(svg, /stroke-dasharray=/);
    assert.match(svg, />\?<\/text>/);
    assert.match(svg, new RegExp(`<circle[^>]*stroke="${OPEN_BORDER}"`));
  });

  test('suggested: solid purple border, a filled "+" badge', () => {
    const svg = statusSwatchMarkup('suggested', 0, 0, 18);
    assert.match(svg, new RegExp(`stroke="${SUGGESTED_BORDER}"`));
    assert.doesNotMatch(svg, /stroke-dasharray=/);
    assert.match(svg, new RegExp(`<circle[^>]*fill="${SUGGESTED_BORDER}"`));
    assert.match(svg, />\+<\/text>/);
  });

  test('every visual property is an explicit attribute, so it survives without a page', () => {
    const svg = statusSwatchMarkup('open', 5, 7, 18) + statusSwatchMarkup('suggested', 5, 7, 18);
    assert.doesNotMatch(svg, /class=/);
    assert.match(svg, /<rect x="5" y="7" width="18" height="18"/);
  });
});

describe('the interactive key', () => {
  test('renders one item per status present, with the count and the meaning', async () => {
    const html = await renderMap(mixedDoc());
    assert.strictEqual((html.match(/class="status-key"/g) || []).length, 1);
    assert.match(html, /<span class="key-item" data-status="open">/);
    assert.match(html, /<span class="key-item" data-status="suggested">/);
    assert.match(html, /Open question<\/span> <span class="key-count">\(2\)<\/span>/);
    assert.match(html, /Suggested, not yet in use<\/span> <span class="key-count">\(1\)<\/span>/);
  });

  test('is absent from a map of confirmed facts, so a plain map gains no chrome', async () => {
    assert.strictEqual(statusKeyMarkup(confirmedDoc()), '');
    const html = await renderMap(MEDUSA);
    assert.doesNotMatch(html, /class="status-key"/);
    assert.doesNotMatch(html, /class="key-item"/);
  });

  test('is in the artifact fragment too', async () => {
    const html = await renderMap(mixedDoc(), { fragment: true });
    assert.match(html, /class="status-key"/);
  });

  test('is named for assistive technology and its swatches are decorative', async () => {
    const html = await renderMap(mixedDoc());
    assert.match(html, /<div class="status-key" role="group" aria-label="Key">/);
    assert.match(html, /<svg class="key-swatch"[^>]*aria-hidden="true">/);
  });

  test('the viewer recounts the key on every layer change, through textContent only', async () => {
    const script = scriptOf(await renderMap(mixedDoc()));
    const start = script.indexOf('function applyLayers()');
    const applyLayers = script.slice(start, script.indexOf("cb.addEventListener('change', applyLayers)", start));
    assert.match(applyLayers, /keyItems\.forEach/);
    assert.match(applyLayers, /\.key-count'\)\.textContent = /);
    assert.match(applyLayers, /item\.classList\.toggle\('hidden-by-layer', count === 0\)/);
    assert.match(applyLayers, /statusKey\.classList\.toggle\('hidden-by-layer'/);
    assert.doesNotMatch(applyLayers, /innerHTML/);
  });

  test('the export carries the on-screen key into the file, in a row of its own', async () => {
    const script = scriptOf(await renderMap(mixedDoc()));
    assert.match(script, /function exportKeyGroup\(x, y\)/);
    assert.match(script, /group\.setAttribute\('class', 'export-key'\)/);
    assert.match(script, /box\.height \+= EXPORT_KEY_ROW/);
    // Only entries on screen travel: a hidden entry is skipped.
    assert.match(script, /!item\.classList\.contains\('hidden-by-layer'\)/);
    // The key's text style rides in the embedded stylesheet.
    assert.match(script, /\.export-key text\{/);
  });
});

describe('the documentation export', () => {
  const ALL = { layers: ['base', 'business'] };

  test('carries a key row when the figure has open or suggested nodes', async () => {
    const svg = await renderSvg(mixedDoc(), ALL);
    assert.match(svg, /Open question \(2\)/);
    assert.match(svg, /Suggested, not yet in use \(1\)/);
    // Well-formed, and text escaped by the same esc() as everything else.
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.ok(parsed.documentElement);
  });

  test('has no key row, and is exactly as tall as before, when every node is confirmed', async () => {
    const svg = await renderSvg(confirmedDoc());
    assert.doesNotMatch(svg, /Open question|Suggested, not yet in use/);
    assert.strictEqual(docStatusKeyMarkup(confirmedDoc().nodes, 0, 0), '');
  });

  test('the row is reserved under the content, so the figure grows by DOC_KEY_BLOCK_HEIGHT', async () => {
    const withKey = await buildDocSvg(mixedDoc(), ALL);
    const plain = { ...mixedDoc(), nodes: mixedDoc().nodes.map(n => ({ ...n, status: 'confirmed', prompt: undefined, rationale: undefined, cites: undefined, integration: undefined })) };
    const withoutKey = await buildDocSvg(plain, ALL);
    const [, , , heightWith] = viewBoxOf(withKey.svg);
    const [, , , heightWithout] = viewBoxOf(withoutKey.svg);
    assert.strictEqual(heightWith - heightWithout, DOC_KEY_BLOCK_HEIGHT);
  });

  test('the key follows the layer filter: a figure without the business layer has no suggested entry', async () => {
    const svg = await renderSvg(mixedDoc(), { layers: ['base'] });
    assert.match(svg, /Open question \(2\)/);
    assert.doesNotMatch(svg, /Suggested, not yet in use/);
  });

  test('the key sits below every drawn box', async () => {
    const { svg, layout, labelReserve } = await buildDocSvg(mixedDoc(), ALL);
    let contentBottom = -Infinity;
    Object.values(layout.nodeBoxes).forEach(b => { contentBottom = Math.max(contentBottom, b.y + b.h + labelReserve); });
    Object.values(layout.frameBoxes).forEach(b => { contentBottom = Math.max(contentBottom, b.y + b.h); });
    const keyRect = /<rect x="[-\d.]+" y="([-\d.]+)" width="16" height="16"/.exec(svg);
    assert.ok(keyRect, 'expected a 16px key swatch');
    assert.ok(Number(keyRect[1]) >= contentBottom, `key at y=${keyRect[1]} must sit below the content bottom ${contentBottom}`);
  });
});
