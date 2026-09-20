// renderHtml(layout, doc) -> self-contained HTML string. Pure function, no IO.

const { esc, layersOf, nodeMarkup, handleMarkup, frameMarkup, edgeMarkup } = require('./render-svg');
const { noteMarkup } = require('./notes-render');
const { css, script } = require('./render-shell');
const { correctBarMarkup } = require('./render-correct');
const { buildCardData } = require('./card-data');
const {
  DOT_GRID_GAP,
  DOT_COLOR,
  CANVAS_FILL,
  LABEL_RESERVE,
  GROUP_PADDING,
  GRID,
  FRAME_LABEL_OFFSET_X,
  FRAME_LABEL_OFFSET_Y,
} = require('./constants');

// Numeric-only geometry the viewer needs to recompute a frame's box for
// whichever members are currently visible (frame-box.js), and nothing
// else -- no free text, so no escaping concerns beyond what safeJson()
// already does uniformly for every embedded literal.
function buildGeometryData(layout) {
  // Object.create(null): a node id is author-controlled and ID_RE allows
  // "__proto__" as a legal id. Keying a plain {} by it would silently
  // reassign the object's prototype instead of storing that node's box.
  const nodeBoxes = Object.create(null);
  Object.entries(layout.nodeBoxes).forEach(([id, b]) => {
    nodeBoxes[id] = { x: b.x, y: b.y, w: b.w, h: b.h };
  });
  return {
    nodeBoxes,
    labelReserve: LABEL_RESERVE,
    padding: GROUP_PADDING,
    grid: GRID,
    frameLabelOffsetX: FRAME_LABEL_OFFSET_X,
    frameLabelOffsetY: FRAME_LABEL_OFFSET_Y,
  };
}

// "Payment provider, service, receives from 1, sends to 2" — the exact
// shape docs/design/n8n-visual-style.md gives as the node aria-label
// example. Built from the same card data embedded for the details card, so
// the accessible name and the card content can never disagree on counts.
function nodeAriaLabel(cardNode) {
  return `${cardNode.label}, ${cardNode.kind}, receives from ${cardNode.receivesFrom.length}, sends to ${cardNode.sendsTo.length}`;
}

function edgeAriaLabel(cardEdge) {
  const condition = cardEdge.condition ? `, ${cardEdge.condition}` : '';
  return `${cardEdge.fromLabel} to ${cardEdge.toLabel}, ${cardEdge.type}${condition}`;
}

const LAYER_TITLES = { base: 'Base', edge: 'Edge cases', business: 'Business', build: 'Build' };

function presentLayers(doc) {
  const set = new Set(['base']);
  doc.nodes.forEach(n => layersOf(n).forEach(l => set.add(l)));
  (doc.notes || []).forEach(n => layersOf(n).forEach(l => set.add(l)));
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

// `opts.fragment`: returns the artifact fragment instead of a full document
// (docs/design/skills-and-plugin.md, "the artifact output rule"; see also
// docs/design/git-map.md section 4) -- a `<title>`, `<style>`, the map
// markup and the single viewer `<script>`, with no `<!DOCTYPE>`, `<html>`,
// `<head>` or `<body>`. A host that supplies its own page skeleton (Claude's
// artifact publisher) wraps this directly. Called with no `opts` (the
// default) this is unchanged from before fragment mode existed --
// tests/n8n-render-golden.test.js pins that byte-for-byte.
function renderHtml(layout, doc, opts = {}) {
  const fragment = !!opts.fragment;
  const { nodeBoxes, frameBoxes, noteBoxes, handles, edges, entryIds, canvas } = layout;
  const entrySet = new Set(entryIds);

  const cardData = buildCardData(doc, layout);
  const cardNodeById = new Map(cardData.nodes.map(c => [c.id, c]));
  const geometry = buildGeometryData(layout);

  const bgPad = 4000;
  const bg = `<rect x="${canvas.x - bgPad}" y="${canvas.y - bgPad}" width="${canvas.width + bgPad * 2}" height="${canvas.height + bgPad * 2}" fill="${CANVAS_FILL}"/>` +
    `<rect x="${canvas.x - bgPad}" y="${canvas.y - bgPad}" width="${canvas.width + bgPad * 2}" height="${canvas.height + bgPad * 2}" fill="url(#dot-grid)"/>`;

  const framesSvg = doc.groups
    .map(g => (frameBoxes[g.id] ? frameMarkup(g, frameBoxes[g.id]) : ''))
    .join('\n');

  // cardData.edges preserves doc.edges' index order exactly (see
  // card-data.js), so edges[i] and cardData.edges[i] describe the same edge.
  const edgesSvg = edges.map(e => edgeMarkup(e, edgeAriaLabel(cardData.edges[e.index]))).join('\n');

  const nodesSvg = doc.nodes
    .map(n => {
      const box = nodeBoxes[n.id];
      if (!box) return '';
      const ariaLabel = nodeAriaLabel(cardNodeById.get(n.id));
      return nodeMarkup(n, box, entrySet.has(n.id), ariaLabel) + handleMarkup(n.id, handles);
    })
    .join('\n');

  const notesSvg = (doc.notes || [])
    .map(n => {
      const box = noteBoxes[n.id];
      if (!box) return '';
      return noteMarkup(n, box);
    })
    .join('\n');

  const svg = `<svg id="canvas-svg" xmlns="http://www.w3.org/2000/svg">
${svgDefs()}
<g id="viewport">
${bg}
<g class="frames-layer">${framesSvg}</g>
<g class="edges-layer">${edgesSvg}</g>
<g class="nodes-layer">${nodesSvg}</g>
<g class="notes-layer">${notesSvg}</g>
</g>
</svg>`;

  const title = esc(doc.title || 'SequentDraw map');
  const body = `<div id="stage">${svg}</div>
<div class="title-bar">${title}</div>
${layerBarMarkup(doc)}
<div class="zoom-bar">
<button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">&#8722;</button>
<button id="zoom-fit" type="button" title="Fit to view" aria-label="Fit to view">&#9678;</button>
<button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">&#43;</button>
</div>
<div id="details-card" class="details-card" hidden></div>
${correctBarMarkup()}
<script>${script(canvas, cardData, geometry, doc, { fragment })}</script>`;

  if (fragment) {
    return `<title>${title}</title>
<style>${css({ fragment: true })}</style>
${body}`;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${title}</title>
<style>${css()}</style>
</head>
<body>
${body}
</body>
</html>`;
}

module.exports = { renderHtml };
