// Caption wrapping for the documentation export. See
// docs/design/n8n-visual-style.md "Captions": "the node `description` is
// wrapped to at most 2 lines at 12px and ends with '…' if longer."
//
// Reuses geometry.js's wrapLabel — the same conservative average-glyph-
// width wrap already used for the node label and frame titles — rather
// than a second wrapping implementation.

const { wrapLabel } = require('./geometry');
const {
  NODE_SIZE,
  CAPTION_FONT_SIZE,
  CAPTION_LINE_HEIGHT,
  CAPTION_LINES_MAX,
  CAPTION_GAP,
  CAPTION_WRAP_PAD,
} = require('./constants');

const CAPTION_WRAP_WIDTH = NODE_SIZE + CAPTION_WRAP_PAD;

// text -> array of at most CAPTION_LINES_MAX plain-text lines (no markup:
// per spec, a caption is plain text, never Markdown), the last ending in
// "…" if the description didn't fit.
function wrapCaption(text) {
  if (!text) return [];
  return wrapLabel(text, CAPTION_WRAP_WIDTH, CAPTION_LINES_MAX, CAPTION_FONT_SIZE);
}

// Extra vertical space (beyond the interactive LABEL_RESERVE) needed to
// fit the tallest caption among `nodes` — a single number applied
// uniformly to every node's reserved strip (see doc-layout.js), matching
// how LABEL_RESERVE itself is already one constant shared by every node
// rather than a per-node value.
function captionReserveExtra(nodes) {
  let maxLines = 0;
  nodes.forEach(n => {
    const lines = wrapCaption(n.description);
    if (lines.length > maxLines) maxLines = lines.length;
  });
  // +4px slack below the last caption line's baseline (descenders,
  // rounding) so routing/note obstacle boxes stay a hair clear of the
  // rendered glyphs, not flush against them.
  return maxLines > 0 ? CAPTION_GAP + maxLines * CAPTION_LINE_HEIGHT + 4 : 0;
}

module.exports = { wrapCaption, captionReserveExtra, CAPTION_WRAP_WIDTH };
