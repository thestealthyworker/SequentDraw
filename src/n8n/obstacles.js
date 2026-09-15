// Shared obstacle-box estimates for text areas that edges must not cross:
// a node's reserved label+sublabel strip beneath it, and a group frame's
// title text. Both the router (routing.js, via layout.js) and the
// measurement script (scripts/measure-n8n-layout.js) use these exact same
// boxes, so "does this edge cross label text" means the same thing whether
// it's steering a path or scoring one.

const { LABEL_RESERVE } = require('./constants');

// Matches the footprint already used for node-vs-node label-overlap
// checks (see layout.js resolveOverlaps / the layout test's `footprint`
// helper): the node's own width, `labelReserve` tall, starting at the
// node's bottom edge. `labelReserve` defaults to the interactive
// LABEL_RESERVE; the doc-export layout pass (doc-layout.js) passes a
// taller value so this same box also covers caption text underneath the
// label/sublabel, keeping routing and note placement clear of captions
// without a second, duplicate obstacle box.
function nodeLabelBox(nodeBox, labelReserve) {
  return { x: nodeBox.x, y: nodeBox.y + nodeBox.h, w: nodeBox.w, h: labelReserve == null ? LABEL_RESERVE : labelReserve };
}

function labelBoxesOf(nodeBoxes, labelReserve) {
  return Object.entries(nodeBoxes).map(([id, b]) => ({ id, ...nodeLabelBox(b, labelReserve) }));
}

// Rough bounding box for a frame's title text, matching its render-svg.js
// placement (x = frame.x + 12, y = frame.y + 22 baseline, 13px, no wrap):
// wide enough for the label at a conservative average glyph width, capped
// to the frame's own width so a long title doesn't claim space outside it.
const FRAME_TITLE_FONT_SIZE = 13;
const FRAME_TITLE_AVG_CHAR = FRAME_TITLE_FONT_SIZE * 0.62;
const FRAME_TITLE_X_OFFSET = 12;
const FRAME_TITLE_Y_OFFSET = 8; // above the 22px baseline, clears the ascent
const FRAME_TITLE_HEIGHT = 20;

function frameTitleBox(frame, label) {
  const textWidth = Math.max(24, String(label || '').length * FRAME_TITLE_AVG_CHAR);
  const w = Math.min(textWidth, Math.max(24, frame.w - FRAME_TITLE_X_OFFSET * 2));
  return { x: frame.x + FRAME_TITLE_X_OFFSET, y: frame.y + FRAME_TITLE_Y_OFFSET, w, h: FRAME_TITLE_HEIGHT };
}

function frameTitleBoxesOf(groups, frameBoxes) {
  return groups.filter(g => frameBoxes[g.id]).map(g => ({ id: g.id, ...frameTitleBox(frameBoxes[g.id], g.label) }));
}

module.exports = { nodeLabelBox, labelBoxesOf, frameTitleBox, frameTitleBoxesOf };
