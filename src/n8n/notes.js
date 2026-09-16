// Sticky-note sizing and placement. Runs after node boxes and frame boxes
// are final but BEFORE edges are routed — notes are obstacles for routing
// too (see docs/design/n8n-visual-style.md "Notes (text boxes)" and
// "Placement"), so their boxes must exist first.
//
// Placement rule (docs/design/n8n-visual-style.md): an attached note sits
// "beside the bounding box of the nodes it names". The search below looks
// for the placement that actually satisfies that, rather than taking the
// first gap that happens to be free: it sweeps all four sides at growing
// offsets AND slides along each side, and scores every clear candidate by
// how many of the note's targets it ends up further than
// NOTE_ATTACH_MAX_GAP from. Sliding is what does most of the work — a note
// beside a tall stack of nodes has to be level with them, not merely on
// the correct side of the bounding box.
//
// Some notes cannot be placed beside everything they name: the Medusa
// fixture attaches one note to two nodes that the layout puts 1,100px
// apart, and no single box is near both. Those get a connector line to
// each target they could not reach (see connectorsFor), which is the other
// half of "a note is attributed to what it names". That line is routed
// around whatever stands between the two (note-connector.js), because a
// leader drawn through an unrelated node mis-attributes the note just as
// badly as parking it next to one.

const {
  snap,
  GRID,
  LABEL_RESERVE,
  NOTE_MIN_WIDTH,
  NOTE_MAX_WIDTH,
  NOTE_PAD_X,
  NOTE_PAD_Y,
  NOTE_GAP,
  NOTE_ATTACH_MAX_GAP,
} = require('./constants');
const { layoutMarkdown } = require('./markdown');
const { frameTitleBoxesOf } = require('./obstacles');
const { routeNoteConnector, connectorPath } = require('./note-connector');
const { samplePath, pointInRect } = require('./sample-path');

// Width grows with content length so a short note stays compact and a long
// one doesn't force excessive wrapping; all tiers are already 16px-grid
// multiples. This is a heuristic, not a measurement — actual height always
// comes from layoutMarkdown against the chosen width.
function pickWidth(content) {
  const len = String(content).length;
  if (len <= 90) return NOTE_MIN_WIDTH;
  if (len <= 200) return 320;
  if (len <= 380) return 400;
  return NOTE_MAX_WIDTH;
}

function sizeNote(content) {
  const width = pickWidth(content);
  const innerWidth = width - NOTE_PAD_X * 2;
  const mdLayout = layoutMarkdown(content, innerWidth);
  // Round the height up generously (8px) rather than trusting the estimate
  // to the pixel — a cheap extra safety margin against overflow.
  const height = Math.ceil((mdLayout.height + NOTE_PAD_Y * 2) / 8) * 8;
  return { width, height, mdLayout };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Shortest distance between two axis-aligned boxes: 0 when they touch or
// overlap, otherwise the diagonal across whatever gap separates them. This
// is the "how far is this note from the thing it annotates" measure the
// placement search minimises and the proximity test asserts on.
function rectGap(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function centreOf(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function nodeFootprint(box, labelReserve) {
  return { x: box.x, y: box.y, w: box.w, h: box.h + (labelReserve == null ? LABEL_RESERVE : labelReserve) };
}

function contentBBox(nodeBoxes, frameBoxes, labelReserve) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  Object.values(nodeBoxes).forEach(b => {
    const fp = nodeFootprint(b, labelReserve);
    minX = Math.min(minX, fp.x);
    minY = Math.min(minY, fp.y);
    maxX = Math.max(maxX, fp.x + fp.w);
    maxY = Math.max(maxY, fp.y + fp.h);
  });
  Object.values(frameBoxes).forEach(f => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// One box per attach target, each the thing a reader actually sees: a
// node's shape plus its reserved label strip, or a group's whole frame.
// Kept per-target (rather than collapsed straight to a bounding box) so
// placement can tell "near all of them" from "near the middle of them".
function attachTargetBoxes(attachTo, nodeBoxes, frameBoxes, labelReserve) {
  return attachTo
    .map(id => {
      if (nodeBoxes[id]) return { id, ...nodeFootprint(nodeBoxes[id], labelReserve) };
      if (frameBoxes[id]) {
        const f = frameBoxes[id];
        return { id, x: f.x, y: f.y, w: f.w, h: f.h };
      }
      return null;
    })
    .filter(Boolean);
}

function boundingBoxOf(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  boxes.forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const DIRS = ['above', 'right', 'below', 'left'];

function isVerticalSide(dir) {
  return dir === 'above' || dir === 'below';
}

// `offset` pushes the note away from the target; `slide` moves it along
// the side it sits on. Offset 0 is the spec's plain "beside it".
function candidateBox(target, w, h, dir, offset, slide) {
  if (dir === 'above') return { x: snap(target.x + slide), y: snap(target.y - NOTE_GAP - offset - h), w, h };
  if (dir === 'below') return { x: snap(target.x + slide), y: snap(target.y + target.h + NOTE_GAP + offset), w, h };
  if (dir === 'right') return { x: snap(target.x + target.w + NOTE_GAP + offset), y: snap(target.y + slide), w, h };
  return { x: snap(target.x - NOTE_GAP - offset - w), y: snap(target.y + slide), w, h }; // left
}

// Slide offsets that keep the note overlapping the target along the side
// it sits on, so the gap to the target stays the offset itself rather than
// growing diagonally. Ordered from the centred position outwards, so a
// note prefers to sit level with what it annotates.
function slideOffsets(span, size) {
  const centred = Math.round((span - size) / 2);
  const lo = -size + GRID;
  const hi = span - GRID;
  const offsets = [];
  for (let s = Math.ceil(lo / GRID) * GRID; s <= hi; s += GRID) offsets.push(s);
  if (!offsets.length) offsets.push(centred);
  offsets.sort((a, b) => Math.abs(a - centred) - Math.abs(b - centred) || a - b);
  return offsets;
}

// Lexicographic compare of two score tuples: every component is a number,
// so this stays a total order and placement stays deterministic.
function scoreLessThan(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// [targets too far away, edge paths blocked, worst distance to any target,
// distance from the bounding box's centre, preferred side, x, y]. "Too far
// away" leads because getting a note beside everything it names is the
// whole point. Blocked paths come next: routing runs after this and treats
// notes as obstacles, so a note parked on a connection leaves the router
// nowhere to go. Worst-distance then pulls the note as close as it can get
// to the rest.
function scoreFor(box, targetBoxes, bbox, dirIndex, edgePaths) {
  let far = 0;
  let worst = 0;
  targetBoxes.forEach(t => {
    const gap = rectGap(box, t);
    if (gap > NOTE_ATTACH_MAX_GAP) far++;
    if (gap > worst) worst = gap;
  });
  // Counted against a box inflated by one grid step, not the box itself.
  // The provisional paths were routed before any note existed, and the
  // final pass re-routes around wherever every note ended up, so a path
  // that merely grazes this candidate now may well cross it then. Asking
  // for a little clearance absorbs that shift instead of chasing it.
  let blocked = 0;
  const clearance = { x: box.x - GRID, y: box.y - GRID, w: box.w + GRID * 2, h: box.h + GRID * 2 };
  edgePaths.forEach(points => {
    if (points.some(p => pointInRect(p, clearance))) blocked++;
  });
  const c = centreOf(box);
  const tc = centreOf(bbox);
  return [far, blocked, worst, Math.hypot(c.x - tc.x, c.y - tc.y), dirIndex, box.x, box.y];
}

// How far out the edge-path-avoiding phases are willing to look before
// giving up on avoiding edges altogether. Bounded because these phases
// test every side and slide at every offset; the unbounded last-resort
// sweep below stops at the first offset that yields anything, so it stays
// cheap even when it has to run a long way.
const PATH_CLEAR_SEARCH_MAX = 1024;

// Sweeps offsets outward, and at every offset all four sides and every
// slide position along them, in four phases:
//
//   1. beside its targets AND clear of every edge path — what we want
//   2. clear of every edge path, further out — the note gets a connector,
//      which is better than sitting on top of a connection
//   3. beside its targets, edges be damned
//   4. anywhere at all
//
// Keeping edge paths clear outranks staying close because a note parked
// on a connection leaves the router nowhere to go and the edge ends up
// drawn straight through the note. A note pushed out by phase 2 is still
// attributed correctly: connectorsFor() draws it a line to whatever it
// could no longer reach.
//
// Within a phase, the whole band is searched before anything is chosen, so
// a placement that reaches every target always beats a closer one that
// abandons some.
function placeAttachedNote(bbox, targetBoxes, w, h, isClear, exemptFrames, edgePaths) {
  function bestAt(offset, requirePathsClear) {
    let bestBox = null;
    let bestScore = null;
    DIRS.forEach((dir, dirIndex) => {
      const span = isVerticalSide(dir) ? bbox.w : bbox.h;
      const size = isVerticalSide(dir) ? w : h;
      slideOffsets(span, size).forEach(slide => {
        const box = candidateBox(bbox, w, h, dir, offset, slide);
        if (!isClear(box, exemptFrames)) return;
        const score = scoreFor(box, targetBoxes, bbox, dirIndex, edgePaths);
        if (requirePathsClear && score[1] !== 0) return;
        if (!bestScore || scoreLessThan(score, bestScore)) {
          bestScore = score;
          bestBox = box;
        }
      });
    });
    return { box: bestBox, score: bestScore };
  }

  // `stopAtFirstOffset` is for the outward sweeps, where the offset itself
  // already orders candidates by distance, so there is nothing to gain by
  // looking further once something fits.
  function searchBand(from, to, requirePathsClear, stopAtFirstOffset) {
    let bestBox = null;
    let bestScore = null;
    for (let offset = from; offset <= to; offset += GRID) {
      const found = bestAt(offset, requirePathsClear);
      if (found.box && (!bestScore || scoreLessThan(found.score, bestScore))) {
        bestScore = found.score;
        bestBox = found.box;
      }
      if (stopAtFirstOffset && bestBox) return bestBox;
    }
    return bestBox;
  }

  const nearMax = Math.max(0, NOTE_ATTACH_MAX_GAP - NOTE_GAP);
  return (
    searchBand(0, nearMax, true, false) ||
    searchBand(nearMax + GRID, PATH_CLEAR_SEARCH_MAX, true, true) ||
    searchBand(0, nearMax, false, false) ||
    searchBand(nearMax + GRID, 4000, false, true) ||
    candidateBox(bbox, w, h, 'above', 4000, 0)
  );
}

// A connector for every target the placement could not get beside. Each
// runs from the note's edge to the target's edge, routed by
// note-connector.js so it gets there without passing through anything
// else — straight where a straight line is clear, an orthogonal detour
// where it is not. Notes whose targets are all close get none.
//
// `x1/y1` and `x2/y2` remain the two ends of that route (the note end and
// the target end), so "the connector touches both" is still read off the
// same two fields it always was; `points` and `d` carry the route itself.
function connectorsFor(box, targetBoxes, obstaclesExcept) {
  return targetBoxes
    .filter(t => rectGap(box, t) > NOTE_ATTACH_MAX_GAP)
    .map(t => {
      const points = routeNoteConnector(box, t, obstaclesExcept(t.id));
      const from = points[0];
      const to = points[points.length - 1];
      return {
        target: t.id,
        points: points.map(p => [p.x, p.y]),
        d: connectorPath(points),
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      };
    });
}

// note or map-level boxes -> { [noteId]: { x, y, w, h, color, mdLayout, connectors } }.
// `labelReserve` defaults to the interactive LABEL_RESERVE; see
// nodeFootprint above for why the doc-export pass passes a taller value.
function computeNoteBoxes(doc, nodeBoxes, frameBoxes, labelReserve, provisionalEdges) {
  const notes = Array.isArray(doc.notes) ? doc.notes : [];
  if (!notes.length) return {};

  // Kept id-bearing: `overlaps` ignores the extra field, and connector
  // routing has to exempt the very node a connector is aiming at.
  const nodeFootprints = Object.entries(nodeBoxes).map(([id, b]) => ({ id, ...nodeFootprint(b, labelReserve) }));
  const frameTitleBoxes = frameTitleBoxesOf(doc.groups, frameBoxes);
  const frameEntries = Object.entries(frameBoxes).map(([id, f]) => ({ id, ...f }));
  // Object.create(null): a node id is author-controlled and ID_RE allows
  // "__proto__" as a legal id, so a plain {} would reach the prototype
  // chain instead of storing that node (same hazard as layout.js's own
  // id-keyed maps).
  const nodeById = Object.create(null);
  (doc.nodes || []).forEach(n => {
    nodeById[n.id] = n;
  });

  // Where the edges actually run, from layout.js's provisional routing
  // pass (routed as if there were no notes). Sampled once here rather than
  // per candidate box, since placement tests thousands of candidates
  // against them. Using the real paths rather than straight source-to-
  // target lines matters: a bezier bows away from the straight line and a
  // backward edge detours nowhere near it, so an approximation both misses
  // lanes that are taken and avoids lanes that are free.
  const edgePaths = (provisionalEdges || []).map(e => samplePath(e.d));
  const placed = []; // every note box placed so far this pass, always an obstacle for the next one

  // exemptFrames is null for a map-level note (no frame carve-out
  // applies). For an attached note it holds the frames whose BODY the note
  // may sit over — never their title boxes, which frameTitleBoxes checks
  // unconditionally above with no such exemption.
  function isClear(box, exemptFrames) {
    if (nodeFootprints.some(n => overlaps(box, n))) return false;
    if (frameTitleBoxes.some(t => overlaps(box, t))) return false;
    for (const f of frameEntries) {
      if (exemptFrames && exemptFrames.has(f.id)) continue;
      if (overlaps(box, f)) return false;
    }
    if (placed.some(p => overlaps(box, p))) return false;
    return true;
  }

  // The boxes a connector from this note may not run through: every
  // node's footprint, every note placed so far (the note being placed is
  // not in `placed` yet, and is exempt anyway as one of the line's own
  // ends), and every group's title text. A frame BODY is deliberately
  // absent — a note outside a frame has to cross its border to reach a
  // node inside it, which is the one crossing a reader expects.
  function connectorObstacles(targetId) {
    return [...nodeFootprints, ...placed, ...frameTitleBoxes].filter(o => o.id !== targetId);
  }

  const result = {};
  const bbox = contentBBox(nodeBoxes, frameBoxes, labelReserve);
  let topY = bbox.y; // successive map-level notes stack further up

  notes.forEach(note => {
    const attachTo = Array.isArray(note.attachTo) ? note.attachTo : [];
    const { width, height, mdLayout } = sizeNote(note.content);
    let box;
    let connectors = [];

    if (!attachTo.length) {
      // Map-level: top-left of the canvas, above/left of everything. It
      // names nothing, so there is nothing to sit beside and no connector.
      box = { x: snap(bbox.x), y: snap(topY - NOTE_GAP - height), w: width, h: height };
      let guard = 0;
      while (!isClear(box, null) && guard < 200) {
        box = { ...box, y: box.y - GRID };
        guard++;
      }
      topY = box.y;
    } else {
      // A note annotating a node may sit in the empty space of the frame
      // that node lives in — that is where a reader expects it, and the
      // frame body is the one thing an attached note is allowed to cover
      // (only nodes, label strips and frame titles are off limits).
      // Without the parent-frame exemption a note on a grouped node has to
      // escape its own frame entirely before it can land, which is what
      // put the Medusa consideration notes hundreds of pixels from what
      // they annotate.
      const exemptFrames = new Set(attachTo);
      attachTo.forEach(id => {
        const parentId = nodeById[id] && nodeById[id].parentId;
        if (parentId) exemptFrames.add(parentId);
      });
      const targetBoxes = attachTargetBoxes(attachTo, nodeBoxes, frameBoxes, labelReserve);
      const targetBBox = boundingBoxOf(targetBoxes);
      box = placeAttachedNote(targetBBox, targetBoxes, width, height, isClear, exemptFrames, edgePaths);
      connectors = connectorsFor(box, targetBoxes, connectorObstacles);
    }

    result[note.id] = {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      color: note.color || 'yellow',
      mdLayout,
      connectors,
    };
    placed.push({ ...box, id: note.id });
  });

  return result;
}

module.exports = { computeNoteBoxes, sizeNote, pickWidth, rectGap };
