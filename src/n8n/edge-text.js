// Places a small text label on each included edge that carries a
// `description` or `condition`, per docs/design/n8n-visual-style.md
// "Documentation export" > "Edge text": try the path midpoint, then the
// midpoint of the path's longest straight segment; place it only if its
// box clears every node box, label/caption box, frame title, note and
// already-placed edge label. Otherwise the edge simply gets no text — "It
// is never forced in."

const { EDGE_TEXT_FONT_SIZE, EDGE_TEXT_MAX_CHARS, EDGE_TEXT_PAD_X, EDGE_TEXT_PAD_Y } = require('./constants');

function truncate(text) {
  const s = String(text);
  return s.length <= EDGE_TEXT_MAX_CHARS ? s : `${s.slice(0, EDGE_TEXT_MAX_CHARS - 1)}…`;
}

// Rough conservative glyph width, the same approach as geometry.js's
// wrapLabel/truncateLine (no real font metrics available outside a
// browser).
function measureBox(text) {
  // Same conservative-average-glyph-width family as geometry.js's
  // truncateLine (0.52 for a single line of UI text) — reused verbatim
  // rather than invented fresh, per the codebase's existing wrap approach.
  const avgChar = EDGE_TEXT_FONT_SIZE * 0.52;
  const w = Math.ceil(text.length * avgChar) + EDGE_TEXT_PAD_X * 2;
  const h = EDGE_TEXT_FONT_SIZE + EDGE_TEXT_PAD_Y * 2 + 3;
  return { w, h };
}

// Walks the same two path grammars sample-path.js understands (a single
// cubic bezier, or an M + repeated L/Q rounded-orthogonal polyline) and
// returns every straight (L) segment's two endpoints. A pure bezier path
// has none — Q's rounded corners aren't straight either — so it yields an
// empty list, and the caller falls back to the path midpoint only.
function straightSegments(d) {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g) || [];
  const segs = [];
  let i = 0;
  let cur = null;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      cur = [Number(tokens[i]), Number(tokens[i + 1])];
      i += 2;
    } else if (cmd === 'L') {
      const pt = [Number(tokens[i]), Number(tokens[i + 1])];
      i += 2;
      if (cur) segs.push({ a: cur, b: pt });
      cur = pt;
    } else if (cmd === 'Q') {
      i += 2; // control point: not part of the straight-segment search
      cur = [Number(tokens[i]), Number(tokens[i + 1])];
      i += 2;
    } else if (cmd === 'C') {
      i += 4; // two control points: not part of the straight-segment search
      cur = [Number(tokens[i]), Number(tokens[i + 1])];
      i += 2;
    }
  }
  return segs;
}

function longestSegmentMidpoint(d) {
  const segs = straightSegments(d);
  if (!segs.length) return null;
  let best = null;
  let bestLen = -1;
  segs.forEach(seg => {
    const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
    if (len > bestLen) {
      bestLen = len;
      best = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
    }
  });
  return best;
}

function boxAt([cx, cy], size) {
  return { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function isClear(box, obstacleGroups) {
  return obstacleGroups.every(group => !group.some(o => overlaps(box, o)));
}

// filteredDoc: the layer-filtered doc (for edge.description/condition
// text, in doc.edges order — that order is what makes the result
// deterministic, per the spec's "Deterministic order: by edge index").
// edges: layout.edges (same index alignment as filteredDoc.edges).
// obstacles: { nodeBoxes, labelBoxes, frameTitleBoxes, noteBoxes }, each
// an array of {x,y,w,h}. `labelBoxes` already covers caption text too
// (see obstacles.js nodeLabelBox / doc-layout.js's grown labelReserve).
function placeEdgeTexts(filteredDoc, edges, obstacles) {
  const placed = []; // grows as labels are placed; itself an obstacle for the next edge
  const obstacleGroups = [obstacles.nodeBoxes, obstacles.labelBoxes, obstacles.frameTitleBoxes, obstacles.noteBoxes, placed];
  const labels = [];
  let omittedCount = 0;

  filteredDoc.edges.forEach((e, i) => {
    const text = e.description || e.condition;
    if (!text) return;
    const edge = edges[i];
    if (!edge) return;

    const truncated = truncate(text);
    const size = measureBox(truncated);
    const candidates = [edge.midpoint, longestSegmentMidpoint(edge.d)].filter(Boolean);

    let chosenBox = null;
    for (const candidate of candidates) {
      const box = boxAt(candidate, size);
      if (isClear(box, obstacleGroups)) {
        chosenBox = box;
        break;
      }
    }

    if (chosenBox) {
      placed.push(chosenBox);
      labels.push({ index: i, text: truncated, box: chosenBox });
    } else {
      omittedCount++;
    }
  });

  return { labels, placedCount: labels.length, omittedCount };
}

module.exports = { placeEdgeTexts, truncate, measureBox, longestSegmentMidpoint, straightSegments };
