// Builds the SVG markup: frames, edges, nodes, handles. Pure string
// building — no DOM, so this also runs fine in the CLI / server context.

const ICONS = require('../icons');
const {
  NODE_RADIUS,
  ENTRY_RADIUS,
  NODE_BORDER,
  NODE_BORDER_WIDTH,
  OPEN_FILL,
  OPEN_BORDER,
  SUGGESTED_BORDER,
  EDGE_STROKE,
  EDGE_DASH,
  EDGE_WIDTH,
  GLYPH_STROKE,
  BRAND_ICON_SIZE,
  GLYPH_ICON_SIZE,
  ICON_VIEWBOX,
  HANDLE_RADIUS,
  HANDLE_BORDER,
  GROUP_COLORS,
  GROUP_RADIUS,
  FRAME_LABEL_OFFSET_X,
  FRAME_LABEL_OFFSET_Y,
  LABEL_FIRST_BASELINE_OFFSET,
  LABEL_LINE_HEIGHT,
  SUBLABEL_GAP,
  LABEL_LINES_MAX,
} = require('./constants');
const { roundedRectPath, wrapLabel, truncateLine } = require('./geometry');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function layersOf(entity) {
  return entity.layers && entity.layers.length ? entity.layers : ['base'];
}

function nodeVisualStyle(n) {
  const isOpen = n.status === 'open';
  const isSuggested = n.status === 'suggested';
  const dashed = isOpen || n.kind === 'external';
  const width = isOpen || isSuggested ? 2 : NODE_BORDER_WIDTH;
  const color = isSuggested ? SUGGESTED_BORDER : isOpen ? OPEN_BORDER : NODE_BORDER;
  const fill = isOpen ? OPEN_FILL : '#ffffff';
  return { dashed, width, color, fill, isOpen, isSuggested };
}

function nodeIconMarkup(n, cx, cy) {
  const brand = n.icon ? ICONS.get(n.icon) : null;
  if (brand) {
    const scale = BRAND_ICON_SIZE / ICON_VIEWBOX;
    const half = BRAND_ICON_SIZE / 2;
    return `<g transform="translate(${cx - half} ${cy - half}) scale(${scale})"><path d="${brand.path}" fill="${brand.hex}"/></g>`;
  }
  const glyph = ICONS.glyph[n.kind] || ICONS.glyph.service;
  const scale = GLYPH_ICON_SIZE / ICON_VIEWBOX;
  const half = GLYPH_ICON_SIZE / 2;
  return `<g transform="translate(${cx - half} ${cy - half}) scale(${scale})"><path d="${glyph}" fill="none" stroke="${GLYPH_STROKE}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function statusBadge(n, box) {
  const bx = box.x + box.w - 6;
  const by = box.y + box.h - 6;
  if (n.status === 'open') {
    return `<g class="node-badge"><circle cx="${bx}" cy="${by}" r="10" fill="#ffffff" stroke="${OPEN_BORDER}" stroke-width="1.5"/><text x="${bx}" y="${by + 4}" text-anchor="middle" class="badge-glyph">?</text></g>`;
  }
  if (n.status === 'suggested') {
    return `<g class="node-badge"><circle cx="${bx}" cy="${by}" r="10" fill="${SUGGESTED_BORDER}"/><text x="${bx}" y="${by + 4}" text-anchor="middle" class="badge-glyph" fill="#ffffff">+</text></g>`;
  }
  return '';
}

function nodeMarkup(n, box, isEntry, ariaLabel) {
  const style = nodeVisualStyle(n);
  const rTL = isEntry ? ENTRY_RADIUS : NODE_RADIUS;
  const rBL = isEntry ? ENTRY_RADIUS : NODE_RADIUS;
  const path = roundedRectPath(box.x, box.y, box.w, box.h, rTL, NODE_RADIUS, NODE_RADIUS, rBL);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  const labelLines = wrapLabel(n.label || '', box.w + 48, LABEL_LINES_MAX, 16);
  const labelStartY = box.y + box.h + LABEL_FIRST_BASELINE_OFFSET;
  const labelTspans = labelLines
    .map((line, i) => `<tspan x="${cx}" y="${labelStartY + i * LABEL_LINE_HEIGHT}">${esc(line)}</tspan>`)
    .join('');
  const sublabelY = labelStartY + (labelLines.length - 1) * LABEL_LINE_HEIGHT + SUBLABEL_GAP;
  const sublabelText = n.sublabel ? truncateLine(n.sublabel, box.w + 64, 13) : '';

  const title = n.status === 'open' ? `<title>${esc(n.prompt || n.label)}</title>` : '';

  return `<g class="n8n-node${style.isOpen ? ' is-open' : ''}${style.isSuggested ? ' is-suggested' : ''}" data-id="${esc(n.id)}" data-group="${esc(n.parentId || '')}" data-layers="${esc(layersOf(n).join(' '))}" tabindex="0" aria-label="${esc(ariaLabel)}">
${title}<path class="node-shape" d="${path}" fill="${style.fill}" stroke="${style.color}" stroke-width="${style.width}" ${style.dashed ? 'stroke-dasharray="6 4"' : ''} vector-effect="non-scaling-stroke"/>
${nodeIconMarkup(n, cx, cy)}
${statusBadge(n, box)}
<text class="node-label">${labelTspans}</text>
${sublabelText ? `<text class="node-sublabel" x="${cx}" y="${sublabelY}" text-anchor="middle">${esc(sublabelText)}</text>` : ''}
</g>`;
}

function handleDot(cls, p, nodeId, extraAttrs) {
  return `<circle class="handle ${cls}" data-node="${esc(nodeId)}"${extraAttrs || ''} cx="${p.x}" cy="${p.y}" r="${HANDLE_RADIUS}" fill="#ffffff" stroke="${HANDLE_BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
}

// n8n branch-label style: one shared input dot, one shared output dot, and
// (only for edges carrying a `condition`) one extra dedicated output dot
// per branch with its condition text set beside it — replaces the old
// per-edge handle fan-out and the floating midpoint condition chip.
//
// Every handle carries `data-node` and `data-role` ("in" | "out" |
// "branch"), and a branch handle (plus its condition-label text) also
// carries `data-edge-index`, so the viewer's layer toggler can decide,
// per docs/design/n8n-visual-style.md, whether each handle stays visible
// from the live visibility of the specific edges attached to it (see
// handle-visibility.js) without guessing from geometry.
function handleMarkup(nodeId, handles) {
  const h = handles[nodeId];
  const parts = [];
  if (h.mainIn) parts.push(handleDot('handle-in', h.mainIn, nodeId, ' data-role="in"'));
  if (h.mainOut) parts.push(handleDot('handle-out', h.mainOut, nodeId, ' data-role="out"'));
  h.branches.forEach(b => {
    const attrs = ` data-role="branch" data-edge-index="${b.edgeIdx}"`;
    parts.push(handleDot('handle-out handle-branch', b.point, nodeId, attrs));
    parts.push(
      `<text class="branch-label" data-node="${esc(nodeId)}" data-edge-index="${b.edgeIdx}" x="${b.point.x + HANDLE_RADIUS + 4}" y="${b.point.y - HANDLE_RADIUS - 2}">${esc(b.label)}</text>`,
    );
  });
  return parts.join('');
}

function frameMarkup(group, box) {
  const palette = GROUP_COLORS[group.color] || GROUP_COLORS.gray;
  return `<g class="n8n-frame" data-group="${esc(group.id)}">
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${GROUP_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="1" vector-effect="non-scaling-stroke"/>
<text class="frame-label" x="${box.x + FRAME_LABEL_OFFSET_X}" y="${box.y + FRAME_LABEL_OFFSET_Y}" fill="${palette.title}">${esc(group.label)}</text>
</g>`;
}

function edgeMarkup(edge, ariaLabel) {
  const dashed = edge.type === 'dashed';
  // The condition label lives beside the edge's dedicated branch handle on
  // the source node (see handleMarkup) rather than as a floating midpoint
  // chip, so it is not repeated here — n8n's branch-label convention.
  // No stub markers at a hidden endpoint: the owner decided (overriding
  // SPEC.md's per-edge "stub" rule) that an edge with either endpoint
  // hidden is hidden entirely — see edge-visibility.js and render-shell.js
  // applyLayers(). The details card still lists the connection as
  // "(hidden)", so nothing is silently dropped.
  return `<g class="n8n-edge${dashed ? ' is-dashed' : ''}" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-index="${edge.index}" tabindex="0" aria-label="${esc(ariaLabel)}">
<path class="edge-hit" d="${edge.d}" fill="none" stroke="transparent" stroke-width="16"/>
<path class="edge-line" d="${edge.d}" fill="none" stroke="${EDGE_STROKE}" stroke-width="${EDGE_WIDTH}" vector-effect="non-scaling-stroke" ${dashed ? `stroke-dasharray="${EDGE_DASH}"` : ''} marker-end="url(#n8n-arrow)"/>
</g>`;
}

module.exports = {
  esc,
  layersOf,
  nodeMarkup,
  handleMarkup,
  frameMarkup,
  edgeMarkup,
};
