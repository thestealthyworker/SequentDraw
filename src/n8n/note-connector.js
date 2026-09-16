// Routes the dashed leader line from a sticky note to a target it could
// not be placed beside (see notes.js connectorsFor, and
// docs/design/n8n-visual-style.md "Note connector").
//
// CTO-M1-04, second round: PR #28 drew that leader as a plain straight
// line. On the
// Medusa map that put n_consider_silent_notification's line to `no_notif`
// straight through the body of the unrelated "Event bus / Redis" node,
// clipping its sublabel — so at a glance the note read as belonging to
// Event bus, which is the same mis-attribution CTO-M1-04 was raised about.
// A leader only attributes a note to its target if a reader can follow it
// without it running through anything else.
//
// So: straight when a straight line is clear (the common case, and the
// nicest to read), otherwise the shortest orthogonal detour — one or two
// bends — that clears every obstacle. This mirrors routing.js's
// bezier-when-clear/orthogonal-detour-when-not strategy for edges, but it
// is deliberately its own, much smaller router: an edge runs handle to
// handle between two fixed points, while a leader may leave its note and
// meet its target anywhere on either boundary, so the two have almost no
// geometry in common.

// px kept between a connector and any box it routes past. Enough that the
// line reads as passing beside a node rather than grazing it.
const CONNECTOR_CLEARANCE = 12;

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function centreOf(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// The point on `box`'s boundary closest to `toward` — where a straight
// connector meets the box, so it points at the target instead of at a
// corner. Same rule PR #28 used; kept so a clear straight line is drawn
// exactly where it always was.
function nearestPointOn(box, toward) {
  return {
    x: clamp(toward.x, box.x, box.x + box.w),
    y: clamp(toward.y, box.y, box.y + box.h),
  };
}

// Liang-Barsky clip: does the segment p->q pass through the INTERIOR of
// `rect` inflated by `margin`? Touching an edge is not a crossing, which
// is what lets a connector start and end flush against the boxes it joins
// while still being refused permission to cut through anything else.
function segmentHitsRect(p, q, rect, margin) {
  const m = margin || 0;
  const minX = rect.x - m;
  const minY = rect.y - m;
  const maxX = rect.x + rect.w + m;
  const maxY = rect.y + rect.h + m;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clips = [
    [-dx, p.x - minX],
    [dx, maxX - p.x],
    [-dy, p.y - minY],
    [dy, maxY - p.y],
  ];
  for (const [num, den] of clips) {
    if (num === 0) {
      if (den < 0) return false; // parallel and outside this slab
      continue;
    }
    const t = den / num;
    if (num < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  // A positive-length overlap, not a mere tangent touch at one point.
  return t1 - t0 > 1e-6;
}

function countHits(points, boxes, margin) {
  let hits = 0;
  for (const box of boxes) {
    for (let i = 1; i < points.length; i++) {
      if (segmentHitsRect(points[i - 1], points[i], box, margin)) {
        hits++;
        break; // one box crossed is one problem, however many segments cross it
      }
    }
  }
  return hits;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function roundPoints(points) {
  return points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

// Drops the middle point of any three collinear points, so an L that
// happens to be straight is scored (and drawn) as the straight line it is.
function simplify(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross !== 0) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Anchors for leaving/entering a box sideways (left or right edge, at the
// y that lines up with the other box) and vertically (top or bottom edge,
// at the x that lines up with the other box). Pulled one px inside the
// perpendicular span so an anchor is never exactly a corner, where which
// side the line is on stops being well defined.
function sideAnchors(box, other) {
  const y = clamp(centreOf(other).y, box.y + 1, box.y + box.h - 1);
  return [{ x: box.x, y }, { x: box.x + box.w, y }];
}

function endAnchors(box, other) {
  const x = clamp(centreOf(other).x, box.x + 1, box.x + box.w - 1);
  return [{ x, y: box.y }, { x, y: box.y + box.h }];
}

// Lane positions to try for the middle leg of a Z route: just clear of
// each obstacle's near and far edge, plus the midway line between the two
// boxes. Obstacle edges are what matters — a lane that clears every box it
// runs past is exactly a lane at one of their boundaries.
function lanePositions(boxes, from, to, axis) {
  const values = new Set([Math.round((from + to) / 2)]);
  boxes.forEach(b => {
    const lo = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    values.add(Math.round(lo - CONNECTOR_CLEARANCE));
    values.add(Math.round(lo + size + CONNECTOR_CLEARANCE));
  });
  return [...values].sort((a, b) => a - b);
}

function candidatePaths(noteBox, targetBox, obstacles) {
  const paths = [];

  // The straight line PR #28 drew: preferred whenever it is clear.
  paths.push([nearestPointOn(noteBox, centreOf(targetBox)), nearestPointOn(targetBox, centreOf(noteBox))]);

  const noteSide = sideAnchors(noteBox, targetBox);
  const noteEnd = endAnchors(noteBox, targetBox);
  const targetSide = sideAnchors(targetBox, noteBox);
  const targetEnd = endAnchors(targetBox, noteBox);

  // One bend: out sideways and in from above/below, or the reverse.
  noteSide.forEach(s => targetEnd.forEach(t => paths.push([s, { x: t.x, y: s.y }, t])));
  noteEnd.forEach(s => targetSide.forEach(t => paths.push([s, { x: s.x, y: t.y }, t])));

  // Two bends: out sideways, along a vertical lane, and in sideways; or
  // out vertically, along a horizontal lane, and in vertically.
  const laneXs = lanePositions(obstacles, noteBox.x + noteBox.w / 2, targetBox.x + targetBox.w / 2, 'x');
  const laneYs = lanePositions(obstacles, noteBox.y + noteBox.h / 2, targetBox.y + targetBox.h / 2, 'y');
  noteSide.forEach(s =>
    targetSide.forEach(t => laneXs.forEach(lx => paths.push([s, { x: lx, y: s.y }, { x: lx, y: t.y }, t]))),
  );
  noteEnd.forEach(s =>
    targetEnd.forEach(t => laneYs.forEach(ly => paths.push([s, { x: s.x, y: ly }, { x: t.x, y: ly }, t]))),
  );

  return paths.map(p => simplify(roundPoints(p)));
}

// Lexicographic compare of two score tuples; every component is a number,
// so this stays a total order and routing stays deterministic.
function scoreLessThan(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// [boxes crossed, bends, length, x1, y1, x2, y2]. Crossing nothing is the
// whole point; among clear routes the straight line (no bends) wins, then
// the shortest. The trailing coordinates only break exact ties, so two
// runs on the same layout always pick the same path.
function scoreFor(points, obstacles, endpointBoxes, margin) {
  // The note and its target are checked with no margin whatever the
  // clearance is: the line is *supposed* to finish flush against both, so
  // an inflated box would reject every candidate. Crossing either one's
  // interior on the way is still a defect, and counts double so no amount
  // of shortness buys it.
  const hits = countHits(points, obstacles, margin) + countHits(points, endpointBoxes, 0) * 2;
  const last = points[points.length - 1];
  return [hits, points.length - 2, Math.round(pathLength(points)), points[0].x, points[0].y, last.x, last.y];
}

function bestOf(paths, obstacles, endpointBoxes, margin) {
  let best = null;
  let bestScore = null;
  paths.forEach(points => {
    const score = scoreFor(points, obstacles, endpointBoxes, margin);
    if (!bestScore || scoreLessThan(score, bestScore)) {
      bestScore = score;
      best = points;
    }
  });
  return { points: best, hits: bestScore[0] };
}

// noteBox + targetBox -> the points of a connector that touches both and
// crosses nothing else, as [{x, y}, ...]. `obstacles` are the boxes it may
// not cross: every other node footprint, every other note, and every group
// frame's title text (a frame BODY is not an obstacle — a note outside a
// frame has to cross its border to reach a node inside it).
//
// Tried at full clearance first, then flush against the obstacles if
// nothing else fits, so a cramped layout still yields a legal route rather
// than falling back to a line through a node.
function routeNoteConnector(noteBox, targetBox, obstacles) {
  const endpointBoxes = [noteBox, targetBox];
  const paths = candidatePaths(noteBox, targetBox, obstacles);
  const spaced = bestOf(paths, obstacles, endpointBoxes, CONNECTOR_CLEARANCE);
  if (spaced.hits === 0) return spaced.points;
  const flush = bestOf(paths, obstacles, endpointBoxes, 0);
  return flush.hits === 0 ? flush.points : spaced.points;
}

function connectorPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

module.exports = { routeNoteConnector, connectorPath, segmentHitsRect, CONNECTOR_CLEARANCE };
