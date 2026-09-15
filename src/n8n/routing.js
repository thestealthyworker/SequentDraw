// Chooses and builds an edge's path from its handle points and the final,
// already-decumped node positions — so a route is never computed against
// stale coordinates (see layout.js: routing always runs after node boxes
// are final for this layout pass).
//
// Forward edges (target x >= source x) use a simple bezier when nothing
// sits in the way; when something does, or for backward edges (target left
// of source), they fall back to the same rounded-orthogonal detour shape,
// with the "cruise" y level chosen to actually clear the obstacles in its
// path (and, for forward edges, to avoid unrelated frames too) rather than
// a fixed offset.

const { BACKWARD_STUB, BACKWARD_DROP, BACKWARD_CORNER_RADIUS } = require('./constants');
const { forwardBezierPath, forwardBezierMidpoint, roundedOrthogonalPath, detourPoints, polylineMidpoint } = require('./geometry');

const OBSTACLE_MARGIN = 18; // px clearance kept from an unrelated node box (> the reviewer's 16px bar)
const CRUISE_CLEARANCE = 24; // px kept between a detour's cruise line and the obstacle it clears
const SAMPLE_STEPS = 24;

function sampleBezier(sx, sy, tx, ty, steps) {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 24);
  const c1x = sx + dx;
  const c2x = tx - dx;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
    const y = mt * mt * mt * sy + 3 * mt * mt * t * sy + 3 * mt * t * t * ty + t * t * t * ty;
    pts.push([x, y]);
  }
  return pts;
}

function samplePolyline(points, stepsPerSeg) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    for (let s = 1; s <= stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  return out;
}

function pathHitsBox(points, box, margin) {
  return points.some(
    ([x, y]) => x > box.x - margin && x < box.x + box.w + margin && y > box.y - margin && y < box.y + box.h + margin,
  );
}

function countHits(points, boxes, margin) {
  return boxes.reduce((n, b) => n + (pathHitsBox(points, b, margin) ? 1 : 0), 0);
}

function buildDetour(sx, sy, tx, ty, stub, cruiseY) {
  const pts = detourPoints(sx, sy, tx, ty, stub, cruiseY);
  return { pts, d: roundedOrthogonalPath(pts, BACKWARD_CORNER_RADIUS), midpoint: polylineMidpoint(pts) };
}

// Pushes cruiseY further in `direction` (+1 = downward, -1 = upward) until
// the built detour's own path (not just the obstacles that picked the
// initial guess) clears every box in avoidBoxes, or a small iteration cap
// is hit. Needed because the initial guess is only informed by whatever
// blocked the *straight* bezier — a different box can still sit on the
// chosen detour line itself.
function refineCruiseY(sx, sy, tx, ty, stub, direction, initialY, avoidBoxes) {
  let y = initialY;
  for (let iter = 0; iter < 6; iter++) {
    const { pts } = buildDetour(sx, sy, tx, ty, stub, y);
    const sampled = samplePolyline(pts, 10);
    const hitting = avoidBoxes.filter(b => pathHitsBox(sampled, b, OBSTACLE_MARGIN));
    if (!hitting.length) break;
    y = direction > 0
      ? Math.max(...hitting.map(b => b.y + b.h)) + CRUISE_CLEARANCE
      : Math.min(...hitting.map(b => b.y)) - CRUISE_CLEARANCE;
  }
  return y;
}

// avoidNodeBoxes/avoidFrameBoxes already exclude the edge's own endpoints
// and their own group's frame — see layout.js computeEdges.
function routeForward(sx, sy, tx, ty, avoidNodeBoxes, avoidFrameBoxes) {
  const bezierPts = sampleBezier(sx, sy, tx, ty, SAMPLE_STEPS);
  const nodeBlockers = avoidNodeBoxes.filter(b => pathHitsBox(bezierPts, b, OBSTACLE_MARGIN));

  if (!nodeBlockers.length) {
    return { d: forwardBezierPath(sx, sy, tx, ty), midpoint: forwardBezierMidpoint(sx, sy, tx, ty) };
  }

  const preferredY = (sy + ty) / 2;
  const allAvoid = avoidNodeBoxes.concat(avoidFrameBoxes);
  const xMin = Math.min(sx, tx);
  const xMax = Math.max(sx, tx);
  // Two starting guesses: clear just the node(s) that blocked the bezier
  // (a tight detour), and clear every avoid box (node or frame) actually
  // in the edge's x-span (a wide detour that goes all the way around a
  // stack of frames when a tight one would still cut through one of
  // them). Each guess is refined in both directions, then every result is
  // scored so whichever genuinely collides least wins — this is what lets
  // an edge that must pass several stacked, unrelated frames go around
  // the whole stack instead of clipping the middle one.
  const inSpan = allAvoid.filter(b => b.x < xMax && b.x + b.w > xMin);
  const guesses = [Math.min(...nodeBlockers.map(b => b.y)) - CRUISE_CLEARANCE, Math.max(...nodeBlockers.map(b => b.y + b.h)) + CRUISE_CLEARANCE];
  if (inSpan.length) {
    guesses.push(Math.min(...inSpan.map(b => b.y)) - CRUISE_CLEARANCE, Math.max(...inSpan.map(b => b.y + b.h)) + CRUISE_CLEARANCE);
  }

  let best = null;
  for (const guess of guesses) {
    for (const direction of [1, -1]) {
      const y = refineCruiseY(sx, sy, tx, ty, BACKWARD_STUB, direction, guess, allAvoid);
      const { pts, d, midpoint } = buildDetour(sx, sy, tx, ty, BACKWARD_STUB, y);
      const hits = countHits(samplePolyline(pts, 8), allAvoid, OBSTACLE_MARGIN);
      const score = hits * 1000 + Math.abs(y - preferredY);
      if (!best || score < best.score) best = { score, d, midpoint };
    }
  }
  return best;
}

// The initial guess only has to clear node boxes, per the fix-round brief:
// "must pass below the lowest node box in the x-range they span." The
// refinement pass then also tries (without breaking that floor) to clear
// frames it doesn't belong to, same as the forward router — it just never
// goes back *above* the node-clearing floor to do it.
function routeBackward(sx, sy, tx, ty, avoidNodeBoxes, avoidFrameBoxes) {
  const xMin = Math.min(sx, tx) - BACKWARD_STUB;
  const xMax = Math.max(sx, tx) + BACKWARD_STUB;
  const inRange = avoidNodeBoxes.filter(b => b.x < xMax && b.x + b.w > xMin);
  const defaultY = sy + BACKWARD_DROP;
  const nodeFloor = inRange.length ? Math.max(defaultY, Math.max(...inRange.map(b => b.y + b.h)) + CRUISE_CLEARANCE) : defaultY;
  const afterNodes = refineCruiseY(sx, sy, tx, ty, BACKWARD_STUB, 1, nodeFloor, avoidNodeBoxes);
  const afterFrames = (avoidFrameBoxes || []).length
    ? refineCruiseY(sx, sy, tx, ty, BACKWARD_STUB, 1, afterNodes, avoidNodeBoxes.concat(avoidFrameBoxes))
    : afterNodes;
  return buildDetour(sx, sy, tx, ty, BACKWARD_STUB, Math.max(afterNodes, afterFrames));
}

module.exports = { routeForward, routeBackward };
