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
  MONOGRAM_FONT_SIZE,
  MONOGRAM_FONT_SIZE_PAIR,
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
  SUBLABEL_LINE_HEIGHT,
  LABEL_LINES_MAX,
} = require('./constants');
const { roundedRectPath, wrapLabel } = require('./geometry');
const { getIntegration } = require('../catalogue');
const { wrapSublabel } = require('./sublabel');

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

// A monogram for a named product that has no brand mark (issue #55).
//
// A suggestion carries its catalogue `integration`, so the map knows it is
// Pipedrive or Postmark -- but Simple Icons carries no mark for 25 of the
// 76 catalogue entries (measured against simple-icons 15.22; Microsoft,
// LinkedIn and others withdrew theirs). Those used to fall back to the
// generic service glyph, the same box any unnamed service gets, so a
// client read them as less real than the suggestions beside them that
// had a logo.
//
// So a node that names a product but has no mark gets that product's
// initials instead: up to two, from its first two words ("Microsoft
// Teams" -> "MT", "Pipedrive" -> "P"). It is specific without borrowing
// anyone's trademark -- a letter in SequentDraw's own type and colour, not
// the brand's logo or palette.
function monogramOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

function nodeIconMarkup(n, cx, cy) {
  const brand = n.icon ? ICONS.get(n.icon) : null;
  if (brand) {
    const scale = BRAND_ICON_SIZE / ICON_VIEWBOX;
    const half = BRAND_ICON_SIZE / 2;
    return `<g transform="translate(${cx - half} ${cy - half}) scale(${scale})"><path d="${brand.path}" fill="${brand.hex}"/></g>`;
  }
  const product = n.integration ? getIntegration(n.integration) : null;
  const initials = product ? monogramOf(product.name) : '';
  if (initials) {
    const size = initials.length > 1 ? MONOGRAM_FONT_SIZE_PAIR : MONOGRAM_FONT_SIZE;
    return `<text class="node-monogram" x="${cx}" y="${cy + size * 0.35}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${GLYPH_STROKE}">${esc(initials)}</text>`;
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

// The status key (docs/design/n8n-visual-style.md "Status key"). A map
// that carries `open` or `suggested` nodes says on screen what those
// styles mean, because the meaning is otherwise only in the details card
// and a static figure has no card at all. One entry per status present,
// in this order; nothing at all when every node is confirmed. Note
// colours are deliberately not in the key: the schema gives a note's
// colour no meaning, and a note that carries one ("Consider:",
// "Repository:") says so in its own first line.
const STATUS_KEY = [
  { status: 'open', text: 'Open question' },
  { status: 'suggested', text: 'Suggested, not yet in use' },
];

function statusKeyEntries(nodes) {
  return STATUS_KEY.map(entry => ({
    ...entry,
    count: nodes.filter(n => n.status === entry.status).length,
  })).filter(entry => entry.count > 0);
}

// A miniature of the node style for the key: the same border, fill, dash
// and badge grammar as nodeVisualStyle()/statusBadge(), scaled to `size`
// px, drawn with its top-left corner at (x, y). Returned as bare SVG
// elements with explicit presentation attributes (no classes), so the
// interactive key can wrap them in its own <svg>, the doc export can place
// them straight onto the figure, and the viewer's image export can clone
// them into a file that has no page around it.
function statusSwatchMarkup(status, x, y, size) {
  const style = nodeVisualStyle({ status });
  const r = Math.round(size * 0.22);
  const badgeR = Math.round(size * 0.24);
  const bx = x + size - badgeR * 0.6;
  const by = y + size - badgeR * 0.6;
  const glyphSize = Math.round(badgeR * 1.4);
  const glyphY = by + glyphSize * 0.36;
  const rect = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${style.fill}" stroke="${style.color}" stroke-width="1.5"${style.dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
  if (status === 'open') {
    return `${rect}<circle cx="${bx}" cy="${by}" r="${badgeR}" fill="#ffffff" stroke="${OPEN_BORDER}" stroke-width="1"/><text x="${bx}" y="${glyphY}" text-anchor="middle" font-size="${glyphSize}" font-weight="700" fill="${GLYPH_STROKE}">?</text>`;
  }
  return `${rect}<circle cx="${bx}" cy="${by}" r="${badgeR}" fill="${SUGGESTED_BORDER}"/><text x="${bx}" y="${glyphY}" text-anchor="middle" font-size="${glyphSize}" font-weight="700" fill="#ffffff">+</text>`;
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
  // Wrapped, never cut: see src/n8n/sublabel.js. The first line sits exactly
  // where the single truncated line used to, so nothing moves on a map whose
  // sublabels already fitted.
  const sublabelLines = wrapSublabel(n.sublabel);

  const title = n.status === 'open' ? `<title>${esc(n.prompt || n.label)}</title>` : '';

  return `<g class="n8n-node${style.isOpen ? ' is-open' : ''}${style.isSuggested ? ' is-suggested' : ''}" data-id="${esc(n.id)}" data-group="${esc(n.parentId || '')}" data-layers="${esc(layersOf(n).join(' '))}" tabindex="0" aria-label="${esc(ariaLabel)}">
${title}<path class="node-shape" d="${path}" fill="${style.fill}" stroke="${style.color}" stroke-width="${style.width}" ${style.dashed ? 'stroke-dasharray="6 4"' : ''} vector-effect="non-scaling-stroke"/>
${nodeIconMarkup(n, cx, cy)}
${statusBadge(n, box)}
<text class="node-label">${labelTspans}</text>
${sublabelLines.length ? `<text class="node-sublabel" text-anchor="middle">${sublabelLines.map((line, i) => `<tspan x="${cx}" y="${sublabelY + i * SUBLABEL_LINE_HEIGHT}">${esc(line)}</tspan>`).join('')}</text>` : ''}
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
  // Exported for reuse by render-svg-doc.js (the documentation export's
  // markup builders), so node shape/icon/badge grammar is defined in
  // exactly one place for both outputs, per "same n8n visual grammar" in
  // docs/design/n8n-visual-style.md.
  nodeVisualStyle,
  nodeIconMarkup,
  monogramOf,
  statusBadge,
  handleDot,
  statusKeyEntries,
  statusSwatchMarkup,
};
