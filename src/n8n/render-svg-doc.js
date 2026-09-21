// SVG markup for the documentation export (renderSvg). Reuses the shape,
// icon, badge and handle building blocks from render-svg.js so the node,
// edge, handle and frame grammar matches the interactive view exactly —
// see docs/design/n8n-visual-style.md "Documentation export" ("Look: Same
// n8n visual grammar, minus the viewer"). What's different here, applied
// throughout:
//
//   - no tabindex, no aria-*, no data-* wiring (none of that is read by
//     anything once there is no viewer script)
//   - no <title> hover tooltip
//   - every visual property is an explicit presentation attribute rather
//     than a CSS class, because this file emits no <style> element
//   - captions under the label/sublabel, an edge-text label with a white
//     background, and note links rendered as plain underlined text
//     instead of an <a> element (an image cannot be clicked)
//
// Security: every piece of untrusted text (label, sublabel, description,
// condition, group label, note content, title) goes through esc() or
// markdown.js's own escaping (already applied to note run.text/run.href —
// see notes-render.js's header comment, which applies here identically)
// before it reaches markup. There is no href anywhere in this file.

const { esc, nodeVisualStyle, nodeIconMarkup, statusBadge, statusKeyEntries, statusSwatchMarkup } = require('./render-svg');
const { roundedRectPath, wrapLabel, truncateLine } = require('./geometry');
const { wrapCaption } = require('./captions');
const { metricsFor } = require('./markdown');
const {
  NODE_RADIUS,
  ENTRY_RADIUS,
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
  CAPTION_FONT_SIZE,
  CAPTION_LINE_HEIGHT,
  CAPTION_GAP,
  CAPTION_COLOR,
  EDGE_STROKE,
  EDGE_DASH,
  EDGE_WIDTH,
  NOTE_COLORS,
  NOTE_PAD_X,
  NOTE_PAD_Y,
  NOTE_RADIUS,
  NOTE_BORDER_WIDTH,
  NOTE_BLANK_GAP,
  EDGE_TEXT_FONT_SIZE,
  EDGE_TEXT_LINE_HEIGHT,
  EDGE_TEXT_PAD_X,
  EDGE_TEXT_PAD_Y,
  EDGE_TEXT_COLOR,
  EDGE_TEXT_BG,
  EDGE_TEXT_BORDER,
} = require('./constants');

// --- nodes -------------------------------------------------------------

function docNodeMarkup(n, box, isEntry) {
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

  // Caption: under the label/sublabel, wrapped to at most 2 lines at
  // 12px, ending in "…" if longer — see captions.js. Starts below the
  // sublabel when there is one, otherwise below the label itself.
  const captionBase = n.sublabel ? sublabelY : labelStartY + (labelLines.length - 1) * LABEL_LINE_HEIGHT;
  const captionLines = wrapCaption(n.description);
  const captionFirstY = captionBase + CAPTION_GAP + CAPTION_FONT_SIZE;
  const captionTspans = captionLines
    .map(
      (line, i) =>
        `<tspan x="${cx}" y="${captionFirstY + i * CAPTION_LINE_HEIGHT}">${esc(line)}</tspan>`,
    )
    .join('');

  return `<g>
<path d="${path}" fill="${style.fill}" stroke="${style.color}" stroke-width="${style.width}" ${style.dashed ? 'stroke-dasharray="6 4"' : ''}/>
${nodeIconMarkup(n, cx, cy)}
${statusBadge(n, box)}
<text text-anchor="middle" font-size="16" font-weight="500" fill="#1a1a18">${labelTspans}</text>
${sublabelText ? `<text x="${cx}" y="${sublabelY}" text-anchor="middle" font-size="13" fill="#77776f">${esc(sublabelText)}</text>` : ''}
${captionLines.length ? `<text text-anchor="middle" font-size="${CAPTION_FONT_SIZE}" fill="${CAPTION_COLOR}">${captionTspans}</text>` : ''}
</g>`;
}

// --- handles -------------------------------------------------------------

function docHandleDot(p) {
  return `<circle cx="${p.x}" cy="${p.y}" r="${HANDLE_RADIUS}" fill="#ffffff" stroke="${HANDLE_BORDER}" stroke-width="1"/>`;
}

// Handles drawn only where an included edge attaches, per the doc-export
// spec — which falls straight out of computeHandles() only ever having
// been given the FILTERED doc's edges (see render-doc.js), the same
// function the interactive view uses.
function docHandleMarkup(handles) {
  const parts = [];
  if (handles.mainIn) parts.push(docHandleDot(handles.mainIn));
  if (handles.mainOut) parts.push(docHandleDot(handles.mainOut));
  handles.branches.forEach(b => {
    parts.push(docHandleDot(b.point));
    parts.push(
      `<text x="${b.point.x + HANDLE_RADIUS + 4}" y="${b.point.y - HANDLE_RADIUS - 2}" font-size="11" fill="#5b5b57">${esc(b.label)}</text>`,
    );
  });
  return parts.join('');
}

// --- frames --------------------------------------------------------------

function docFrameMarkup(group, box) {
  const palette = GROUP_COLORS[group.color] || GROUP_COLORS.gray;
  return `<g>
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${GROUP_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="1"/>
<text x="${box.x + FRAME_LABEL_OFFSET_X}" y="${box.y + FRAME_LABEL_OFFSET_Y}" font-size="13" font-weight="600" fill="${palette.title}">${esc(group.label)}</text>
</g>`;
}

// --- edges -----------------------------------------------------------------

function docEdgeMarkup(edge) {
  const dashed = edge.type === 'dashed';
  return `<path d="${edge.d}" fill="none" stroke="${EDGE_STROKE}" stroke-width="${EDGE_WIDTH}" ${dashed ? `stroke-dasharray="${EDGE_DASH}"` : ''} marker-end="url(#n8n-doc-arrow)"/>`;
}

// An edge label is wrapped (edge-text.js), so it draws one tspan per line
// rather than a single centred string. Baselines start one font-size below
// the box's top padding, matching how measureBox sized the box.
function docEdgeTextMarkup(label) {
  const { box, lines } = label;
  const textX = box.x + box.w / 2;
  const firstBaseline = box.y + EDGE_TEXT_PAD_Y + EDGE_TEXT_FONT_SIZE;
  const tspans = lines
    .map((line, i) => `<tspan x="${textX}" y="${firstBaseline + i * EDGE_TEXT_LINE_HEIGHT}">${esc(line)}</tspan>`)
    .join('');
  return `<g>
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="4" fill="${EDGE_TEXT_BG}" stroke="${EDGE_TEXT_BORDER}" stroke-width="1"/>
<text text-anchor="middle" font-size="${EDGE_TEXT_FONT_SIZE}" fill="${EDGE_TEXT_COLOR}">${tspans}</text>
</g>`;
}

// --- notes -----------------------------------------------------------------
//
// run.text and run.href are already HTML-escaped by markdown.js (see
// notes-render.js's header comment) — do NOT esc() them again here.
// Unlike the interactive view, a link never becomes an <a>: it renders as
// plain underlined text, because a static image cannot be clicked (per
// the doc-export spec's "Notes" row).

function docRunMarkup(run) {
  const attrs = [];
  if (run.bold) attrs.push('font-weight="700"');
  if (run.italic) attrs.push('font-style="italic"');
  if (run.code) attrs.push('font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12"');
  if (run.href) attrs.push('text-decoration="underline"');
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
  return `<tspan${attrStr}>${run.text}</tspan>`;
}

function docLineMarkup(line, box, y) {
  if (line.kind === 'blank') return '';
  const isHeading = line.kind === 'h1' || line.kind === 'h2';
  const headingAttrs = isHeading ? ` font-size="${metricsFor(line.kind).fontSize}" font-weight="700"` : '';
  const textX = box.x + NOTE_PAD_X + line.indent;
  const parts = [];
  if (line.bulletMarker) {
    parts.push(`<tspan x="${box.x + NOTE_PAD_X}" y="${y}">•</tspan>`);
  }
  const runs = line.runs.map(docRunMarkup).join('');
  parts.push(`<tspan x="${textX}" y="${y}"${headingAttrs}>${runs}</tspan>`);
  return parts.join('');
}

// A connector to a target the note could not be placed beside — see
// notes.js. Drawn before the note body so the note sits on top of the
// line's own end, and as a <path> because the route may bend around
// whatever stands between the two (note-connector.js). The `note-link`
// class is cosmetic here — the static figure has no viewer — but it keeps
// the two outputs' connectors identifiable by the same name.
function docNoteConnectorMarkup(connector, palette) {
  return `<path class="note-link" d="${connector.d}" fill="none" stroke="${palette.border}" stroke-width="1" stroke-dasharray="4 4" opacity="0.8"/>`;
}

function docNoteMarkup(note, box) {
  const palette = NOTE_COLORS[box.color] || NOTE_COLORS.yellow;
  const connectors = (box.connectors || []).map(c => docNoteConnectorMarkup(c, palette)).join('');

  let y = box.y + NOTE_PAD_Y;
  const tspans = [];
  box.mdLayout.lines.forEach(line => {
    if (line.kind === 'blank') {
      y += NOTE_BLANK_GAP;
      return;
    }
    const { fontSize, lineHeight } = metricsFor(line.kind);
    y += fontSize;
    tspans.push(docLineMarkup(line, box, y));
    y += lineHeight - fontSize;
  });

  return `<g>
${connectors}
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${NOTE_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="${NOTE_BORDER_WIDTH}"/>
<text font-size="13" fill="#3a3a35">${tspans.join('')}</text>
</g>`;
}

// --- status key ------------------------------------------------------------
//
// The static figure has no details card, so it is the one output where the
// meaning of a dashed "?" node or a purple "+" node is otherwise nowhere at
// all. One row along the bottom-left of the figure, present only when the
// filtered document has such nodes (render-doc.js reserves the row's
// height only then). Same swatch grammar as the interactive key. Text
// width is estimated the way truncateLine() does (0.52em per character),
// which only decides the gap to the next entry.

const DOC_KEY_SWATCH = 16;
const DOC_KEY_FONT_SIZE = 11;
const DOC_KEY_TEXT_GAP = 6; // swatch -> text
const DOC_KEY_ENTRY_GAP = 20; // between entries
const DOC_KEY_AVG_CHAR = 0.52;

function docStatusKeyMarkup(nodes, x, y) {
  const entries = statusKeyEntries(nodes);
  if (!entries.length) return '';
  let cursor = x;
  const parts = entries.map(entry => {
    const swatch = statusSwatchMarkup(entry.status, cursor, y, DOC_KEY_SWATCH);
    const textX = cursor + DOC_KEY_SWATCH + DOC_KEY_TEXT_GAP;
    const text = `${entry.text} (${entry.count})`;
    const textY = y + DOC_KEY_SWATCH - 3;
    cursor = textX + text.length * DOC_KEY_FONT_SIZE * DOC_KEY_AVG_CHAR + DOC_KEY_ENTRY_GAP;
    return `${swatch}<text x="${textX}" y="${textY}" font-size="${DOC_KEY_FONT_SIZE}" fill="#5b5b57">${esc(text)}</text>`;
  });
  return `<g>${parts.join('')}</g>`;
}

module.exports = {
  docStatusKeyMarkup,
  docNodeMarkup,
  docHandleMarkup,
  docFrameMarkup,
  docEdgeMarkup,
  docEdgeTextMarkup,
  docNoteMarkup,
};
