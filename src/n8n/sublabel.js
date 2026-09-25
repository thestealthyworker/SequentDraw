// Sublabel wrapping for the interactive canvas (issue #54).
//
// The sublabel is the one line meant to say what a node does. It used to be
// put through truncateLine() and cut with an ellipsis at every zoom level,
// so the M2 review read "chases unanswered quot…" and "invoice and
// reconcilia…" on the canvas while the details card held the full text.
// Truncated beside a brand icon it reads as noise, and on a suggested node
// it is the only on-canvas explanation of the suggestion.
//
// So it wraps instead, the way the documentation export has always wrapped
// captions (captions.js) -- with one difference that matters. A caption
// wraps to as many lines as it needs because a figure has no hover card at
// all. A sublabel has one, so it wraps to at most SUBLABEL_LINES_MAX and
// leaves the rest to the card: three lines of 13px text under a 96px node
// is already as much as the canvas can carry without the label becoming the
// node.
//
// Three lines is not arbitrary. validate.js caps a sublabel at 3 words and
// 60 characters, and three lines of this width hold 63 -- so every
// schema-legal sublabel fits, and the ellipsis is unreachable rather than
// merely rarer. The one exception is a single unbreakable word longer than
// one line, which overflows horizontally exactly as it already does in a
// node label; wrapLabel does not hyphenate, and inventing a break here
// would make the sublabel the only text in the product that does.

const { wrapLabel } = require('./geometry');
const {
  NODE_SIZE,
  SUBLABEL_FONT_SIZE,
  SUBLABEL_LINE_HEIGHT,
  SUBLABEL_LINES_MAX,
  SUBLABEL_WRAP_PAD,
} = require('./constants');

// The same width the truncating version used (`box.w + 64`), kept exactly
// so this change is vertical only: no sublabel moves sideways, and no
// column has to be re-measured.
const SUBLABEL_WRAP_WIDTH = NODE_SIZE + SUBLABEL_WRAP_PAD;

function wrapSublabel(text) {
  if (!text) return [];
  return wrapLabel(text, SUBLABEL_WRAP_WIDTH, SUBLABEL_LINES_MAX, SUBLABEL_FONT_SIZE);
}

// Extra vertical space beyond LABEL_RESERVE, which already budgets for one
// sublabel line below a two-line label. Only the lines past the first cost
// anything, and the largest need is applied to every node uniformly --
// matching how LABEL_RESERVE is itself one constant shared by every node
// rather than a per-node value (captions.js takes the same approach for the
// documentation export).
//
// A map whose sublabels all fit on one line reserves exactly what it
// reserved before, so nothing moves on any existing map.
function sublabelReserveExtra(nodes) {
  let extraLines = 0;
  (nodes || []).forEach(n => {
    const lines = wrapSublabel(n.sublabel).length;
    if (lines - 1 > extraLines) extraLines = lines - 1;
  });
  return extraLines * SUBLABEL_LINE_HEIGHT;
}

module.exports = { wrapSublabel, sublabelReserveExtra, SUBLABEL_WRAP_WIDTH };
