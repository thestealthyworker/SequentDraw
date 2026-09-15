// layoutMap(doc, { strategy }) -> plain object describing everything the
// renderer needs: node boxes, handle points, frame boxes, edge paths and
// overall canvas bounds. Pure function, no IO.

const { validateDoc } = require('./validate');
const { layoutFlat } = require('./layout-flat');
const { layoutRows } = require('./layout-rows');
const {
  snap,
  NODE_SIZE,
  NODE_GAP,
  LABEL_RESERVE,
  GROUP_PADDING,
  CANVAS_MARGIN,
} = require('./constants');
const {
  forwardBezierPath,
  forwardBezierMidpoint,
  roundedOrthogonalPath,
  backwardDetourPoints,
  polylineMidpoint,
} = require('./geometry');
const { BACKWARD_STUB, BACKWARD_DROP, BACKWARD_CORNER_RADIUS } = require('./constants');

function computeFrameBoxes(doc, nodeBoxes) {
  const frameBoxes = {};
  doc.groups.forEach(g => {
    const memberIds = doc.nodes.filter(n => n.parentId === g.id).map(n => n.id);
    if (!memberIds.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    memberIds.forEach(id => {
      const b = nodeBoxes[id];
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h + LABEL_RESERVE);
    });
    const x = Math.floor((minX - GROUP_PADDING.left) / 16) * 16;
    const y = Math.floor((minY - GROUP_PADDING.top) / 16) * 16;
    const right = Math.ceil((maxX + GROUP_PADDING.right) / 16) * 16;
    const bottom = Math.ceil((maxY + GROUP_PADDING.bottom) / 16) * 16;
    frameBoxes[g.id] = { x, y, w: right - x, h: bottom - y, memberIds };
  });
  return frameBoxes;
}

// ELK's layered compaction can, in rare cases, place two unrelated nodes
// closer together than the requested nodeNode spacing (observed on nodes
// with no edges within their own rank). Rather than fight ELK's internals,
// sweep the result and push any node whose reserved footprint (its 96x96
// shape plus the label strip below it) collides with another node straight
// down until it clears — a small, deterministic, strategy-agnostic fixup.
function resolveOverlaps(nodeBoxes) {
  const ids = Object.keys(nodeBoxes);
  const footprintH = id => nodeBoxes[id].h + LABEL_RESERVE;
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const a = nodeBoxes[ids[i]];
        const b = nodeBoxes[ids[j]];
        const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
        const yOverlap = a.y < b.y + footprintH(ids[j]) && b.y < a.y + footprintH(ids[i]);
        if (!xOverlap || !yOverlap) continue;
        const [upper, lower] = a.y <= b.y ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const requiredY = snap(nodeBoxes[upper].y + footprintH(upper));
        if (nodeBoxes[lower].y < requiredY) {
          nodeBoxes[lower].y = requiredY;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Companion to resolveOverlaps: the same ELK compaction quirk can also
// leave two nodes that share a row squeezed far closer *horizontally* than
// the requested rank spacing (observed as low as 16px instead of 96+),
// which reads as overlapping labels even though the 96x96 shapes
// technically don't touch. Push the right-hand node out to a sane minimum.
function resolveHorizontalCrowding(nodeBoxes) {
  const ids = Object.keys(nodeBoxes);
  const minGap = NODE_GAP;
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const a = nodeBoxes[ids[i]];
        const b = nodeBoxes[ids[j]];
        if (b.x <= a.x) continue; // only consider b strictly to the right of a
        const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
        if (!yOverlap) continue;
        const gap = b.x - (a.x + a.w);
        if (gap < 0 || gap >= minGap) continue; // real overlaps are handled elsewhere
        const requiredX = snap(a.x + a.w + minGap);
        if (requiredX > b.x) {
          b.x = requiredX;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function computeEntrySet(doc) {
  const hasInbound = new Set(doc.edges.map(e => e.to));
  return new Set(doc.nodes.filter(n => !hasInbound.has(n.id)).map(n => n.id));
}

// Handles are drawn only where an edge attaches, spread evenly by count
// along the node's left (inputs) / right (outputs) edge.
function computeHandles(doc, nodeBoxes) {
  const byId = {};
  doc.nodes.forEach(n => (byId[n.id] = n));
  const outEdgesOf = new Map();
  const inEdgesOf = new Map();
  doc.nodes.forEach(n => {
    outEdgesOf.set(n.id, []);
    inEdgesOf.set(n.id, []);
  });
  doc.edges.forEach((e, i) => {
    outEdgesOf.get(e.from).push(i);
    inEdgesOf.get(e.to).push(i);
  });

  const handles = {}; // nodeId -> { out: { edgeIndex -> {x,y} }, in: { edgeIndex -> {x,y} } }
  doc.nodes.forEach(n => {
    const box = nodeBoxes[n.id];
    const out = outEdgesOf.get(n.id).slice().sort((a, b) => nodeBoxes[doc.edges[a].to].y - nodeBoxes[doc.edges[b].to].y);
    const inn = inEdgesOf.get(n.id).slice().sort((a, b) => nodeBoxes[doc.edges[a].from].y - nodeBoxes[doc.edges[b].from].y);
    const outPoints = {};
    out.forEach((edgeIdx, i) => {
      outPoints[edgeIdx] = { x: box.x + box.w, y: box.y + ((i + 1) * box.h) / (out.length + 1) };
    });
    const inPoints = {};
    inn.forEach((edgeIdx, i) => {
      inPoints[edgeIdx] = { x: box.x, y: box.y + ((i + 1) * box.h) / (inn.length + 1) };
    });
    handles[n.id] = { out: outPoints, in: inPoints };
  });
  return handles;
}

function computeEdges(doc, handles) {
  return doc.edges.map((e, i) => {
    const s = handles[e.from].out[i];
    const t = handles[e.to].in[i];
    const forward = t.x >= s.x;
    let d;
    let midpoint;
    if (forward) {
      d = forwardBezierPath(s.x, s.y, t.x, t.y);
      midpoint = forwardBezierMidpoint(s.x, s.y, t.x, t.y);
    } else {
      const pts = backwardDetourPoints(s.x, s.y, t.x, t.y, BACKWARD_STUB, BACKWARD_DROP);
      d = roundedOrthogonalPath(pts, BACKWARD_CORNER_RADIUS);
      midpoint = polylineMidpoint(pts);
    }
    return {
      index: i,
      from: e.from,
      to: e.to,
      type: e.type || 'solid',
      condition: e.condition || null,
      forward,
      d,
      start: [s.x, s.y],
      end: [t.x, t.y],
      midpoint,
    };
  });
}

function computeCanvasBounds(nodeBoxes, frameBoxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  Object.values(nodeBoxes).forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h + LABEL_RESERVE);
  });
  Object.values(frameBoxes).forEach(f => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });
  const x = minX - CANVAS_MARGIN;
  const y = minY - CANVAS_MARGIN;
  const width = maxX - minX + CANVAS_MARGIN * 2;
  const height = maxY - minY + CANVAS_MARGIN * 2;
  return { x, y, width, height };
}

async function layoutMap(doc, options = {}) {
  const strategy = options.strategy === 'rows' ? 'rows' : 'flat';
  const validated = validateDoc(doc);

  const { nodeBoxes } = strategy === 'rows' ? await layoutRows(validated) : await layoutFlat(validated);
  resolveOverlaps(nodeBoxes);
  resolveHorizontalCrowding(nodeBoxes);
  resolveOverlaps(nodeBoxes);

  const frameBoxes = computeFrameBoxes(validated, nodeBoxes);
  const entrySet = computeEntrySet(validated);
  const handles = computeHandles(validated, nodeBoxes);
  const edges = computeEdges(validated, handles);
  const canvas = computeCanvasBounds(nodeBoxes, frameBoxes);

  return {
    strategy,
    nodeBoxes,
    frameBoxes,
    handles,
    edges,
    entryIds: [...entrySet],
    canvas,
  };
}

module.exports = { layoutMap };
