// layoutMap(doc) -> plain object describing everything the renderer needs:
// node boxes, handle points, frame boxes, edge paths and overall canvas
// bounds. Pure function, no IO.

const { validateDoc } = require('./validate');
const { layoutFlat } = require('./layout-flat');
const {
  snap,
  GRID,
  NODE_GAP,
  LABEL_RESERVE,
  GROUP_PADDING,
  CANVAS_MARGIN,
} = require('./constants');

// Rounds of re-placing notes against the routes they changed. Two is
// enough for every fixture measured; the loop stops earlier the moment
// nothing is crossed or a round fails to improve.
const MAX_SETTLE_ROUNDS = 2;
const { routeForward, routeBackward } = require('./routing');
const { labelBoxesOf, frameTitleBoxesOf } = require('./obstacles');
const { computeNoteBoxes } = require('./notes');
const { frameBoxFromMemberBoxes } = require('./frame-box');
const { samplePath, pointInRect } = require('./sample-path');

// Shares its bounding-box math with the viewer's runtime frame resize (see
// frame-box.js's own header) so the two can never compute a different box
// for the same set of members.
function computeFrameBoxes(doc, nodeBoxes, labelReserve) {
  const reserve = labelReserve == null ? LABEL_RESERVE : labelReserve;
  // Object.create(null), not {}: a group id is author-controlled and
  // ID_RE allows "__proto__" as a legal id. Keying a plain {} by it would
  // silently reassign the object's prototype on write (no own property
  // created) instead of storing that group's box, and later reads/
  // Object.entries() would miss it entirely.
  const frameBoxes = Object.create(null);
  doc.groups.forEach(g => {
    const memberIds = doc.nodes.filter(n => n.parentId === g.id).map(n => n.id);
    if (!memberIds.length) return;
    const memberBoxes = memberIds.map(id => nodeBoxes[id]);
    const box = frameBoxFromMemberBoxes(memberBoxes, { labelReserve: reserve, padding: GROUP_PADDING, grid: GRID });
    frameBoxes[g.id] = { ...box, memberIds };
  });
  return frameBoxes;
}

// ELK's layered compaction can, in rare cases, place two unrelated nodes
// closer together than the requested nodeNode spacing (observed on nodes
// with no edges within their own rank). Rather than fight ELK's internals,
// sweep the result and push any node whose reserved footprint (its 96x96
// shape plus the label strip below it) collides with another node straight
// down until it clears — a small, deterministic, strategy-agnostic fixup.
function resolveOverlaps(nodeBoxes, labelReserve) {
  const reserve = labelReserve == null ? LABEL_RESERVE : labelReserve;
  const ids = Object.keys(nodeBoxes);
  const footprintH = id => nodeBoxes[id].h + reserve;
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

  // Object.create(null): same __proto__-as-a-legal-id hazard as
  // computeFrameBoxes above, keyed by node id here.
  const handles = Object.create(null);
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

function computeEdges(doc, handles, nodeBoxes, frameBoxes, noteBoxes, labelReserve) {
  // Object.create(null): same __proto__-as-a-legal-id hazard, keyed by
  // node id here.
  const byId = Object.create(null);
  doc.nodes.forEach(n => (byId[n.id] = n));
  const allNodeBoxes = Object.entries(nodeBoxes).map(([id, b]) => ({ id, ...b }));
  const allFrameBoxes = Object.entries(frameBoxes).map(([id, f]) => ({ id, ...f }));
  // A node's label+sublabel strip is an obstacle exactly like its node box —
  // including the edge's own endpoints, which are NOT exempt here (unlike
  // node boxes themselves, which an edge is obviously allowed to touch at
  // its own handle). A frame's title text is never exempt, even for the
  // edge's own group: an edge entering its destination group legitimately
  // has to cross the frame BODY to reach its member node, but it never has
  // to cross the small title-text area specifically, so unlike the frame
  // body there's no own-group carve-out for it. A note box is never exempt
  // either — no edge routes through a sticky note, own group's or not.
  const allLabelBoxes = labelBoxesOf(nodeBoxes, labelReserve);
  const allFrameTitleBoxes = frameTitleBoxesOf(doc.groups, frameBoxes);
  const allNoteBoxes = Object.entries(noteBoxes || {}).map(([id, b]) => ({ id, x: b.x, y: b.y, w: b.w, h: b.h }));

  return doc.edges.map((e, i) => {
    const s = handles[e.from].out[i];
    const t = handles[e.to].in[i];
    const forward = t.x >= s.x;
    const ownGroups = new Set([byId[e.from].parentId, byId[e.to].parentId].filter(Boolean));
    const avoidNodeBoxes = allNodeBoxes.filter(b => b.id !== e.from && b.id !== e.to).concat(allLabelBoxes).concat(allNoteBoxes);
    const avoidFrameBoxes = allFrameBoxes.filter(f => !ownGroups.has(f.id)).concat(allFrameTitleBoxes);
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

function computeCanvasBounds(nodeBoxes, frameBoxes, noteBoxes, labelReserve) {
  const reserve = labelReserve == null ? LABEL_RESERVE : labelReserve;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  Object.values(nodeBoxes).forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h + reserve);
  });
  Object.values(frameBoxes).forEach(f => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });
  Object.values(noteBoxes || {}).forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  const x = minX - CANVAS_MARGIN;
  const y = minY - CANVAS_MARGIN;
  const width = maxX - minX + CANVAS_MARGIN * 2;
  const height = maxY - minY + CANVAS_MARGIN * 2;
  return { x, y, width, height };
}

// How many edges are drawn through a sticky note — the thing notes and
// routing have to be settled against each other to avoid. Measured with
// the same sampled-path test the invariant tests use, so "settled" here
// means the same thing it means there.
function countNoteCrossings(edges, noteBoxes) {
  const boxes = Object.values(noteBoxes);
  if (!boxes.length) return 0;
  let count = 0;
  edges.forEach(e => {
    const points = samplePath(e.d);
    boxes.forEach(box => {
      if (points.some(p => pointInRect(p, box))) count++;
    });
  });
  return count;
}

// Notes and edges depend on each other: routing has to clear the notes,
// and placement has to know where the edges run or it parks a note on top
// of a connection. Neither can simply go first, so this settles them.
//
// The first round places notes against a provisional routing done as if no
// note existed. That is right for almost every note, but placing the notes
// itself changes where the edges go, and an edge can end up rerouted
// through a note that was clear when it was placed. Each further round
// re-places the notes against the routes that actually came out and
// re-routes against those notes.
//
// Bounded and monotone: it stops as soon as nothing is crossed, keeps a
// round only if it strictly improves, and otherwise returns the best
// result so far — so it converges rather than oscillating, and can never
// return something worse than the single-pass answer.
function settleNotesAndEdges(validated, handles, nodeBoxes, frameBoxes, labelReserve, provisionalEdges) {
  const place = against => computeNoteBoxes(validated, nodeBoxes, frameBoxes, labelReserve, against);
  const route = noteBoxes => computeEdges(validated, handles, nodeBoxes, frameBoxes, noteBoxes, labelReserve);

  let noteBoxes = place(provisionalEdges);
  let edges = route(noteBoxes);
  let crossings = countNoteCrossings(edges, noteBoxes);

  for (let round = 0; round < MAX_SETTLE_ROUNDS && crossings > 0; round++) {
    const nextNotes = place(edges);
    const nextEdges = route(nextNotes);
    const nextCrossings = countNoteCrossings(nextEdges, nextNotes);
    if (nextCrossings >= crossings) break; // no improvement: keep what we have
    noteBoxes = nextNotes;
    edges = nextEdges;
    crossings = nextCrossings;
  }

  return { noteBoxes, edges };
}

// Runs the layout pipeline against an already-validated (or, for the
// doc-export path, filtered-but-not-re-validated — see doc-filter.js) doc
// shape, without calling validateDoc itself. `opts.labelReserve` lets a
// caller grow the reserved label strip to also fit caption text; omitting
// it reproduces the interactive layout's exact LABEL_RESERVE everywhere.
async function layoutValidated(validated, opts = {}) {
  const labelReserve = opts.labelReserve == null ? LABEL_RESERVE : opts.labelReserve;

  const { nodeBoxes } = await layoutFlat(validated, { labelReserve });
  resolveOverlaps(nodeBoxes, labelReserve);
  resolveHorizontalCrowding(nodeBoxes);
  resolveOverlaps(nodeBoxes, labelReserve);

  const frameBoxes = computeFrameBoxes(validated, nodeBoxes, labelReserve);
  const entrySet = computeEntrySet(validated);
  const handles = computeHandles(validated, nodeBoxes);

  // Notes are placed before the edges that count, because routing treats a
  // note as an obstacle it has to clear (see computeEdges above). But
  // placement equally needs to know where the edges are going to run, or a
  // note lands squarely on a connection and leaves the router nowhere to
  // go — which is exactly what happened once notes were allowed to sit
  // inside the frames they annotate.
  //
  // One provisional routing pass settles both directions: routed as if
  // there were no notes at all, its paths tell placement which lanes are
  // already taken, and the real pass below then routes around wherever the
  // notes actually landed. A document with no notes skips the extra pass
  // entirely, so the common case keeps its previous cost and its output is
  // unchanged to the byte.
  const hasNotes = Array.isArray(validated.notes) && validated.notes.length > 0;
  const provisionalEdges = hasNotes
    ? computeEdges(validated, handles, nodeBoxes, frameBoxes, {}, labelReserve)
    : [];
  const { noteBoxes, edges } = hasNotes
    ? settleNotesAndEdges(validated, handles, nodeBoxes, frameBoxes, labelReserve, provisionalEdges)
    : {
        noteBoxes: computeNoteBoxes(validated, nodeBoxes, frameBoxes, labelReserve, provisionalEdges),
        edges: computeEdges(validated, handles, nodeBoxes, frameBoxes, {}, labelReserve),
      };
  const canvas = computeCanvasBounds(nodeBoxes, frameBoxes, noteBoxes, labelReserve);

  return {
    nodeBoxes,
    frameBoxes,
    noteBoxes,
    handles,
    edges,
    entryIds: [...entrySet],
    canvas,
    labelReserve,
  };
}

async function layoutMap(doc, opts = {}) {
  const validated = validateDoc(doc);
  return layoutValidated(validated, opts);
}

module.exports = { layoutMap, layoutValidated };
