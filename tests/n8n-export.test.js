// Exporting the current view as an image (build step 7c). The viewer
// serialises its own inline SVG and rasterises that into a PNG, so there is
// no dependency and no network; these tests assert what the engine emits,
// and the behaviour itself was measured in a browser (see the PR).
//
// This is NOT the documentation export: renderSvg()/doc-map lays the map out
// again with room for full captions, for a figure nobody can hover. This one
// is a picture of what the reader is looking at.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');
const { EXPORT_PNG_SCALE, EXPORT_PNG_MAX_PX } = require('../src/n8n/render-export');

const MEDUSA = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'examples/medusa-return-flow.json'), 'utf8')
);

function scriptOf(html) {
  return html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
}

describe('the export controls', () => {
  test('both buttons render once, with titles saying what they do', async () => {
    const html = await renderMap(MEDUSA);
    assert.strictEqual((html.match(/id="export-svg"/g) || []).length, 1);
    assert.strictEqual((html.match(/id="export-png"/g) || []).length, 1);
    assert.match(html, /title="Export the current view as an SVG image"/);
    assert.match(html, /title="Export the current view as a PNG image"/);
  });

  test('they are in the artifact fragment too', async () => {
    const html = await renderMap(MEDUSA, { fragment: true });
    assert.match(html, /id="export-svg"/);
    assert.match(html, /id="export-png"/);
  });
});

describe('what the exported file carries', () => {
  test('the page stylesheet is embedded, so the SVG stands alone', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /var EXPORT_STYLE = "/);
    // A class the markup actually uses, proving it is the real stylesheet
    // rather than a placeholder.
    assert.match(script, /\.node-label\{/);
  });

  test('hidden elements are dropped rather than carried as display:none', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /querySelectorAll\('\.hidden-by-layer'\)/);
    assert.match(script, /el\.parentNode\.removeChild\(el\)/);
  });

  test('the view box is the visible content, not the whole graph', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /function exportVisibleBox\(svgRoot\)/);
    assert.match(script, /clone\.setAttribute\('viewBox'/);
  });

  test('the pan and zoom transform is undone, so the file is not a screenshot of the scroll position', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /viewport\.removeAttribute\('transform'\)/);
  });
});

describe('an exported file carries drawing only', () => {
  test('script, foreignObject and the other executable elements are removed', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /querySelectorAll\('script, foreignObject, iframe, image, use, animate, animateTransform, set'\)/);
  });

  test('every on* attribute is removed', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /if \(name\.indexOf\('on'\) === 0\) \{ el\.removeAttribute\(attr\.name\); return; \}/);
  });

  test('a link survives only when it is plain http(s)', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /value\.indexOf\('http:\/\/'\) === 0 \|\| value\.indexOf\('https:\/\/'\) === 0/);
    assert.match(script, /if \(!allowed\) el\.removeAttribute\(attr\.name\)/);
  });

  test('sanitising happens immediately before serialising, not before the clone is measured', async () => {
    // The clone spends a moment in the document to be measured, and
    // anything watching the DOM can write into it in that window -- a
    // browser extension injecting a geolocation shim is how this was found.
    const script = scriptOf(await renderMap(MEDUSA));
    const sanitise = script.indexOf('exportSanitise(clone);');
    const serialise = script.indexOf('new XMLSerializer().serializeToString(clone)');
    const measure = script.indexOf('box = exportVisibleBox(clone)');
    assert.ok(sanitise > measure, 'sanitise must run after the measuring append');
    assert.ok(sanitise < serialise, 'and before the serialisation');
  });
});

describe('the PNG', () => {
  test('is drawn from a data: URL, so the canvas is never tainted', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /data:image\/svg\+xml;base64,/);
    assert.ok(!script.includes("image.setAttribute('src', URL.createObjectURL"), 'not a blob: URL');
  });

  test('is scaled for a retina screen and clamped', async () => {
    assert.strictEqual(EXPORT_PNG_SCALE, 2);
    assert.strictEqual(EXPORT_PNG_MAX_PX, 8000);
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /var EXPORT_PNG_SCALE = 2;/);
    assert.match(script, /var EXPORT_PNG_MAX_PX = 8000;/);
    assert.match(script, /if \(longest > EXPORT_PNG_MAX_PX\)/);
  });

  test('is given a white ground rather than transparency', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /context\.fillStyle = '#ffffff'/);
    assert.match(script, /ground\.setAttribute\('fill', '#ffffff'\)/);
  });
});

describe('the exported file is named after the map', () => {
  test('the title is slugged, capped and given a fallback', async () => {
    const script = scriptOf(await renderMap(MEDUSA));
    assert.match(script, /function exportFileName\(extension\)/);
    assert.match(script, /\|\| 'map'\)\.slice\(0, 60\)/);
  });
});
