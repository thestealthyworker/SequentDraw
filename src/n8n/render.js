// renderHtml(layout, doc) -> self-contained HTML string. Pure function, no IO.

const { esc, layersOf, nodeMarkup, handleMarkup, frameMarkup, edgeMarkup } = require('./render-svg');
const { css, script } = require('./render-shell');
const { DOT_GRID_GAP, DOT_COLOR, CANVAS_FILL } = require('./constants');

const LAYER_TITLES = { base: 'Base', edge: 'Edge cases', business: 'Business', build: 'Build' };

function presentLayers(doc) {
  const set = new Set(['base']);
  doc.nodes.forEach(n => layersOf(n).forEach(l => set.add(l)));
  // Keep the spec's declared order where possible, then anything extra.
  const order = ['base', 'edge', 'business', 'build'];
  return order.filter(l => set.has(l)).concat([...set].filter(l => !order.includes(l)));
}

function layerBarMarkup(doc) {
  const layers = presentLayers(doc);
  const items = layers
    .map(l => {
      const count = doc.nodes.filter(n => layersOf(n).includes(l)).length;
      const title = LAYER_TITLES[l] || l;
      if (l === 'base') {
        return `<label class="is-locked"><input type="checkbox" checked disabled data-layer="base"/>${esc(title)} (${count})</label>`;
      }
      return `<label><input type="checkbox" checked data-layer="${esc(l)}"/>${esc(title)} (${count})</label>`;
    })
    .join('');
  return `<div class="layer-bar">${items}</div>`;
}

function svgDefs() {
  return `<defs>
<marker id="n8n-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M2 1 L8 5 L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
<pattern id="dot-grid" width="${DOT_GRID_GAP}" height="${DOT_GRID_GAP}" patternUnits="userSpaceOnUse">
<circle cx="1" cy="1" r="1" fill="${DOT_COLOR}"/>
</pattern>
</defs>`;
}

function renderHtml(layout, doc) {
  const { nodeBoxes, frameBoxes, handles, edges, entryIds, canvas } = layout;
  const entrySet = new Set(entryIds);

  const bgPad = 4000;
  const bg = `<rect x="${canvas.x - bgPad}" y="${canvas.y - bgPad}" width="${canvas.width + bgPad * 2}" height="${canvas.height + bgPad * 2}" fill="${CANVAS_FILL}"/>` +
    `<rect x="${canvas.x - bgPad}" y="${canvas.y - bgPad}" width="${canvas.width + bgPad * 2}" height="${canvas.height + bgPad * 2}" fill="url(#dot-grid)"/>`;

  const framesSvg = doc.groups
    .map(g => (frameBoxes[g.id] ? frameMarkup(g, frameBoxes[g.id]) : ''))
    .join('\n');

  const edgesSvg = edges.map(edgeMarkup).join('\n');

  const nodesSvg = doc.nodes
    .map(n => {
      const box = nodeBoxes[n.id];
      if (!box) return '';
      return nodeMarkup(n, box, entrySet.has(n.id)) + handleMarkup(n.id, handles);
    })
    .join('\n');

  const svg = `<svg id="canvas-svg" xmlns="http://www.w3.org/2000/svg">
${svgDefs()}
<g id="viewport">
${bg}
<g class="frames-layer">${framesSvg}</g>
<g class="edges-layer">${edgesSvg}</g>
<g class="nodes-layer">${nodesSvg}</g>
</g>
</svg>`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${esc(doc.title || 'SequentDraw map')}</title>
<style>${css()}</style>
</head>
<body>
<div id="stage">${svg}</div>
<div class="title-bar">${esc(doc.title || 'SequentDraw map')}</div>
${layerBarMarkup(doc)}
<div class="zoom-bar">
<button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">&#8722;</button>
<button id="zoom-fit" type="button" title="Fit to view" aria-label="Fit to view">&#9678;</button>
<button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">&#43;</button>
</div>
<script>${script(canvas)}</script>
</body>
</html>`;
}

module.exports = { renderHtml };
