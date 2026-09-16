// Caption wrapping for the documentation export. See
// docs/design/n8n-visual-style.md "Captions": the node `description` is
// wrapped to as many 12px lines as it needs and printed in full.
//
// It deliberately does NOT reuse wrapLabel, which fits a short label into
// a fixed two-line slot and discards the rest. A caption is the opposite
// problem: this figure exists for slides, PDFs and screenshots where
// nobody can hover, so a description cut off at "Owns shipment state,
// including the…" tells the reader strictly less than the node's own
// label already did. geometry.js's wrapParagraph wraps to the needed
// number of lines instead, and the reserved strip below every node grows
// to fit the tallest caption in play (captionReserveExtra below).

const { wrapParagraph } = require('./geometry');
const {
  NODE_SIZE,
  CAPTION_FONT_SIZE,
  CAPTION_LINE_HEIGHT,
  CAPTION_LINES_MAX,
  CAPTION_GAP,
  CAPTION_WRAP_PAD,
} = require('./constants');

const CAPTION_WRAP_WIDTH = NODE_SIZE + CAPTION_WRAP_PAD;

// text -> array of plain-text lines (no markup: per spec, a caption is
// plain text, never Markdown). A schema-legal description always fits, so
// the returned lines carry no "…"; CAPTION_LINES_MAX is only a ceiling
// against pathological input (see constants.js).
function wrapCaption(text) {
  if (!text) return [];
  return wrapParagraph(text, CAPTION_WRAP_WIDTH, CAPTION_LINES_MAX, CAPTION_FONT_SIZE);
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
