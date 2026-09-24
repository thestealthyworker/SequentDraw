// Orchestrates the documentation export: validate -> filter by layer ->
// layout (with a grown label reserve for captions) -> place edge text ->
// assemble one standalone SVG string. See
// docs/design/n8n-visual-style.md "Documentation export (SVG with inline
// captions)" and src/n8n/render.js, which this mirrors for the
// interactive HTML output.
//
// buildDocSvg() returns the SVG plus a couple of counts the measurement
// script wants; the public renderSvg() (src/n8n/index.js) returns just
// the SVG string, per the spec's `renderSvg(doc, { layers })` interface.

const { esc } = require('./render-svg');
const {
  docNodeMarkup,
  docHandleMarkup,
  docFrameMarkup,
  docEdgeMarkup,
  docEdgeTextMarkup,
  docNoteMarkup,
  docStatusKeyMarkup,
} = require('./render-svg-doc');
const { validateDoc } = require('./validate');
const { layoutValidated } = require('./layout');
const { filterDocForLayers } = require('./doc-filter');
const { captionReserveExtra } = require('./captions');
const { sublabelReserveExtra } = require('./sublabel');
const { placeEdgeTexts } = require('./edge-text');
const { labelBoxesOf, frameTitleBoxesOf } = require('./obstacles');
const {
  LABEL_RESERVE,
  DOC_MARGIN,
  DOC_TITLE_FONT_SIZE,
  DOC_TITLE_BLOCK_HEIGHT,
  DOC_KEY_BLOCK_HEIGHT,
  SYSTEM_FONT_STACK,
  EDGE_STROKE,
} = require('./constants');

function svgDefs() {
  // Same arrowhead grammar as the interactive view's #n8n-arrow (see
  // render.js svgDefs) under a distinct id — no <use>/external reference,
  // just this file's own <defs>, so the two outputs' markers never
  // collide if ever inlined together.
  return `<defs>
<marker id="n8n-doc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M2 1 L8 5 L2 9" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
</defs>`;
}

function growBox(bounds, box) {
  bounds.minX = Math.min(bounds.minX, box.x);
  bounds.minY = Math.min(bounds.minY, box.y);
  bounds.maxX = Math.max(bounds.maxX, box.x + box.w);
  bounds.maxY = Math.max(bounds.maxY, box.y + box.h);
}

async function buildDocSvg(doc, opts = {}) {
  const validated = validateDoc(doc);
  const filtered = filterDocForLayers(validated, opts.layers);

  // The reserved label strip grows to fit captions: a single "tallest
  // caption in play" number, applied uniformly (see captions.js and
  // doc-layout parameterisation in layout.js/obstacles.js/notes.js).
  // A wrapped sublabel pushes the caption down by its extra lines, so both
  // extras are needed; each is the maximum over the nodes, so their sum
  // covers the tallest node either way.
  const labelReserve =
    LABEL_RESERVE + sublabelReserveExtra(filtered.nodes) + captionReserveExtra(filtered.nodes);
  const layout = await layoutValidated(filtered, { labelReserve });
  const { nodeBoxes, frameBoxes, noteBoxes, handles, edges, entryIds } = layout;
  const entrySet = new Set(entryIds);

  const nodeBoxList = Object.values(nodeBoxes);
  const labelBoxes = labelBoxesOf(nodeBoxes, labelReserve);
  const frameTitleBoxes = frameTitleBoxesOf(filtered.groups, frameBoxes);
  const noteBoxList = Object.entries(noteBoxes).map(([id, b]) => ({ id, ...b }));

  const edgeText = placeEdgeTexts(filtered, edges, {
    nodeBoxes: nodeBoxList,
    labelBoxes,
    frameTitleBoxes,
    noteBoxes: noteBoxList,
  });

  const framesSvg = filtered.groups.map(g => (frameBoxes[g.id] ? docFrameMarkup(g, frameBoxes[g.id]) : '')).join('\n');
  const edgesSvg = edges.map(e => docEdgeMarkup(e)).join('\n');
  const nodesSvg = filtered.nodes
    .map(n => {
      const box = nodeBoxes[n.id];
      if (!box) return '';
      return docNodeMarkup(n, box, entrySet.has(n.id)) + docHandleMarkup(handles[n.id]);
    })
    .join('\n');
  const notesSvg = filtered.notes.map(n => (noteBoxes[n.id] ? docNoteMarkup(n, noteBoxes[n.id]) : '')).join('\n');
  const edgeTextSvg = edgeText.labels.map(docEdgeTextMarkup).join('\n');

  // Crop to the content with a DOC_MARGIN px margin, plus room above it
  // for the title — a different, smaller margin than the interactive
  // view's CANVAS_MARGIN (which pads a pannable canvas, not a cropped
  // figure). Bounds include every box actually drawn: node footprints
  // (shape + full label/caption reserve), frames, notes and any placed
  // edge-text label.
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  nodeBoxList.forEach(b => growBox(bounds, { x: b.x, y: b.y, w: b.w, h: b.h + labelReserve }));
  Object.values(frameBoxes).forEach(f => growBox(bounds, f));
  noteBoxList.forEach(b => growBox(bounds, b));
  edgeText.labels.forEach(l => growBox(bounds, l.box));
  if (bounds.minX === Infinity) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = 0;
    bounds.maxY = 0;
  }

  // The status key sits in a row of its own under the content, so it can
  // never meet the title or the content on a narrow figure. The row is
  // reserved only when the filtered document has open or suggested nodes
  // to explain; a figure of confirmed facts is exactly as tall as before.
  const keySvg = docStatusKeyMarkup(filtered.nodes, bounds.minX, bounds.maxY + DOC_MARGIN);
  const keyBlock = keySvg ? DOC_KEY_BLOCK_HEIGHT : 0;

  const x = bounds.minX - DOC_MARGIN;
  const y = bounds.minY - DOC_MARGIN - DOC_TITLE_BLOCK_HEIGHT;
  const width = bounds.maxX - bounds.minX + DOC_MARGIN * 2;
  const height = bounds.maxY - bounds.minY + DOC_MARGIN * 2 + DOC_TITLE_BLOCK_HEIGHT + keyBlock;
  const titleY = y + DOC_MARGIN * 0.6 + DOC_TITLE_FONT_SIZE;

  const titleText = filtered.title || 'SequentDraw map';

  const svg = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}" font-family="${SYSTEM_FONT_STACK}">
<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>
${svgDefs()}
<text x="${x + DOC_MARGIN}" y="${titleY}" font-size="${DOC_TITLE_FONT_SIZE}" font-weight="600" fill="#161615">${esc(titleText)}</text>
<g>${framesSvg}</g>
<g>${edgesSvg}</g>
<g>${nodesSvg}</g>
<g>${notesSvg}</g>
<g>${edgeTextSvg}</g>
${keySvg}
</svg>
`;

  return { svg, edgeTextPlaced: edgeText.placedCount, edgeTextOmitted: edgeText.omittedCount, layout, labelReserve };
}

module.exports = { buildDocSvg };
