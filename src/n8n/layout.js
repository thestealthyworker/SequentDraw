// layoutMap(doc) -> plain object describing everything the renderer needs:
// node boxes, handle points, frame boxes, edge paths and overall canvas
// bounds. Pure function, no IO.

const { validateDoc } = require('./validate');
const { layoutFlat } = require('./layout-flat');
const {
  snap,
  NODE_GAP,
  LABEL_RESERVE,
  GROUP_PADDING,
  CANVAS_MARGIN,
} = require('./constants');
const { routeForward, routeBackward } = require('./routing');

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

// Handles, n8n-style: ONE shared main input handle and ONE shared main
// output handle per node, both vertically centred, used by every plain
// edge. An edge carrying a `condition` is a branch and gets its own
// dedicated output handle instead (spread evenly alongside the main-output
// slot when both kinds coexist on a node), labelled with the condition
// text — this is the only case where a node shows more than two handles.
// Handles are omitted entirely on a side with no attached edges.
function computeHandles(doc, nodeBoxes) {
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

  const handles = {};
  doc.nodes.forEach(n => {
    const box = nodeBoxes[n.id];
    const cy = box.y + box.h / 2;

    const inIdx = inEdgesOf.get(n.id);
    const mainIn = inIdx.length ? { x: box.x, y: cy } : null;
    const inPoints = {};
    inIdx.forEach(edgeIdx => {
      inPoints[edgeIdx] = mainIn;
    });

    const outIdx = outEdgesOf.get(n.id);
    const conditionIdx = outIdx.filter(i => doc.edges[i].condition);
    const plainIdx = outIdx.filter(i => !doc.edges[i].condition);
    const outPoints = {};
    const branches = []; // { edgeIdx, label, point } for condition (branch) handles only
    let mainOut = null;

    if (!conditionIdx.length) {
      if (plainIdx.length) {
        mainOut = { x: box.x + box.w, y: cy };
        plainIdx.forEach(i => {
          outPoints[i] = mainOut;
        });
      }
    } else {
      // Slots: one per condition edge, plus one shared slot for every plain
      // edge if any exist, ordered by the average y of what each slot
      // connects to (so the visual order roughly matches target order).
      const slots = conditionIdx.map(i => ({
        edgeIdxs: [i],
        label: doc.edges[i].condition,
        sortY: nodeBoxes[doc.edges[i].to].y,
      }));
      const plainSlot = plainIdx.length
        ? { edgeIdxs: plainIdx, label: null, sortY: plainIdx.reduce((sum, i) => sum + nodeBoxes[doc.edges[i].to].y, 0) / plainIdx.length }
        : null;
      if (plainSlot) slots.push(plainSlot);
      slots.sort((a, b) => a.sortY - b.sortY);
      slots.forEach((slot, i) => {
        const p = { x: box.x + box.w, y: box.y + ((i + 1) * box.h) / (slots.length + 1) };
        slot.edgeIdxs.forEach(idx => {
          outPoints[idx] = p;
        });
        if (slot === plainSlot) mainOut = p;
        else branches.push({ edgeIdx: slot.edgeIdxs[0], label: slot.label, point: p });
      });
    }

    handles[n.id] = { in: inPoints, out: outPoints, mainIn, mainOut, branches };
  });
  return handles;
}

function computeEdges(doc, handles, nodeBoxes, frameBoxes) {
  const byId = {};
  doc.nodes.forEach(n => (byId[n.id] = n));
  const allNodeBoxes = Object.entries(nodeBoxes).map(([id, b]) => ({ id, ...b }));
  const allFrameBoxes = Object.entries(frameBoxes).map(([id, f]) => ({ id, ...f }));

  return doc.edges.map((e, i) => {
    const s = handles[e.from].out[i];
    const t = handles[e.to].in[i];
    const forward = t.x >= s.x;
    const ownGroups = new Set([byId[e.from].parentId, byId[e.to].parentId].filter(Boolean));
    const avoidNodeBoxes = allNodeBoxes.filter(b => b.id !== e.from && b.id !== e.to);
    const avoidFrameBoxes = allFrameBoxes.filter(f => !ownGroups.has(f.id));
    const { d, midpoint } = forward
      ? routeForward(s.x, s.y, t.x, t.y, avoidNodeBoxes, avoidFrameBoxes)
      : routeBackward(s.x, s.y, t.x, t.y, avoidNodeBoxes, avoidFrameBoxes);
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

async function layoutMap(doc) {
  const validated = validateDoc(doc);

  const { nodeBoxes } = await layoutFlat(validated);
  resolveOverlaps(nodeBoxes);
  resolveHorizontalCrowding(nodeBoxes);
  resolveOverlaps(nodeBoxes);

  const frameBoxes = computeFrameBoxes(validated, nodeBoxes);
  const entrySet = computeEntrySet(validated);
  const handles = computeHandles(validated, nodeBoxes);
  const edges = computeEdges(validated, handles, nodeBoxes, frameBoxes);
  const canvas = computeCanvasBounds(nodeBoxes, frameBoxes);

  return {
    nodeBoxes,
    frameBoxes,
    handles,
    edges,
    entryIds: [...entrySet],
    canvas,
  };
}

module.exports = { layoutMap };
