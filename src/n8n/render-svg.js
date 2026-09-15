// Builds the SVG markup: frames, edges, nodes, handles. Pure string
// building — no DOM, so this also runs fine in the CLI / server context.

const ICONS = require('../icons');
const {
  NODE_SIZE,
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

function nodeMarkup(n, box, isEntry) {
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

  return `<g class="n8n-node${style.isOpen ? ' is-open' : ''}${style.isSuggested ? ' is-suggested' : ''}" data-id="${esc(n.id)}" data-group="${esc(n.parentId || '')}" data-layers="${layersOf(n).join(' ')}">
${title}<path class="node-shape" d="${path}" fill="${style.fill}" stroke="${style.color}" stroke-width="${style.width}" ${style.dashed ? 'stroke-dasharray="6 4"' : ''} vector-effect="non-scaling-stroke"/>
${nodeIconMarkup(n, cx, cy)}
${statusBadge(n, box)}
<text class="node-label">${labelTspans}</text>
${sublabelText ? `<text class="node-sublabel" x="${cx}" y="${sublabelY}" text-anchor="middle">${esc(sublabelText)}</text>` : ''}
</g>`;
}

function handleMarkup(nodeId, handles) {
  const out = Object.values(handles[nodeId].out).map(
    p => `<circle class="handle handle-out" cx="${p.x}" cy="${p.y}" r="${HANDLE_RADIUS}" fill="#ffffff" stroke="${HANDLE_BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
  );
  const inn = Object.values(handles[nodeId].in).map(
    p => `<circle class="handle handle-in" cx="${p.x}" cy="${p.y}" r="${HANDLE_RADIUS}" fill="#ffffff" stroke="${HANDLE_BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
  );
  return [...out, ...inn].join('');
}

function frameMarkup(group, box) {
  const palette = GROUP_COLORS[group.color] || GROUP_COLORS.gray;
  return `<g class="n8n-frame" data-group="${esc(group.id)}">
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${GROUP_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="1" vector-effect="non-scaling-stroke"/>
<text class="frame-label" x="${box.x + 12}" y="${box.y + 22}" fill="${palette.title}">${esc(group.label)}</text>
</g>`;
}

function edgeMarkup(edge) {
  const dashed = edge.type === 'dashed';
  const chip = edge.condition
    ? `<g class="edge-chip"><rect x="${edge.midpoint[0] - 30}" y="${edge.midpoint[1] - 9}" width="60" height="18" rx="9" class="edge-chip-bg"/><text x="${edge.midpoint[0]}" y="${edge.midpoint[1] + 4}" text-anchor="middle" class="edge-chip-text">${esc(edge.condition)}</text></g>`
    : '';
  // Pre-rendered, hidden-by-default stub markers at each handle: shown by
  // the layer-toggle script when that specific endpoint's node is hidden
  // but the other endpoint stays visible (SPEC.md "Edges at a visibility
  // boundary").
  const stubs = `<circle class="edge-stub stub-start" cx="${edge.start[0]}" cy="${edge.start[1]}" r="5"/>` +
    `<circle class="edge-stub stub-end" cx="${edge.end[0]}" cy="${edge.end[1]}" r="5"/>`;
  return `<g class="n8n-edge${dashed ? ' is-dashed' : ''}" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-index="${edge.index}">
<path class="edge-hit" d="${edge.d}" fill="none" stroke="transparent" stroke-width="16"/>
<path class="edge-line" d="${edge.d}" fill="none" stroke="${EDGE_STROKE}" stroke-width="${EDGE_WIDTH}" vector-effect="non-scaling-stroke" ${dashed ? `stroke-dasharray="${EDGE_DASH}"` : ''} marker-end="url(#n8n-arrow)"/>
${chip}
${stubs}
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
