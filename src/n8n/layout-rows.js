// Strategy "rows": lay out each group's members internally (ELK, direction
// RIGHT), then stack the group frames top-to-bottom in the order the
// group-level graph flows. Ungrouped nodes join the row of the group they
// connect to most, on the side implied by edge direction; a node with no
// clear best group (none, or a tie) gets its own standalone row.

const { snap, NODE_SIZE, NODE_GAP, RANK_GAP, ROW_GAP, LABEL_RESERVE, GROUP_PADDING } = require('./constants');
const { baseLayoutOptions, leafElkNode, runElk } = require('./elk-helpers');
const { topologicalOrder } = require('./topo');
const { dfsReverseLocal, elkEdgeEndpoints } = require('./direction');

function groupMembersOf(doc) {
  const members = new Map();
  doc.groups.forEach(g => members.set(g.id, []));
  doc.nodes.forEach(n => {
    if (n.parentId && members.has(n.parentId)) members.get(n.parentId).push(n.id);
  });
  return members;
}

// For each ungrouped node, find the group it shares the most edges with.
// Ties, or no connection at all, mean "own row" — the placement is a
// heuristic, so ambiguous cases fall back to the always-legible option.
function attachUngrouped(doc, byId, members) {
  const attachment = new Map(); // nodeId -> { groupId, side }
  const ungrouped = doc.nodes.filter(n => !n.parentId);

  for (const n of ungrouped) {
    const counts = new Map(); // groupId -> { out, in }
    for (const e of doc.edges) {
      if (e.from === n.id) {
        const g = byId[e.to].parentId;
        if (g) counts.set(g, { out: (counts.get(g)?.out || 0) + 1, in: counts.get(g)?.in || 0 });
      } else if (e.to === n.id) {
        const g = byId[e.from].parentId;
        if (g) counts.set(g, { out: counts.get(g)?.out || 0, in: (counts.get(g)?.in || 0) + 1 });
      }
    }
    let best = null;
    let bestTotal = 0;
    let tie = false;
    for (const [g, c] of counts) {
      const total = c.out + c.in;
      if (total > bestTotal) {
        bestTotal = total;
        best = { groupId: g, out: c.out, in: c.in };
        tie = false;
      } else if (total === bestTotal && total > 0) {
        tie = true;
      }
    }
    if (best && !tie) {
      attachment.set(n.id, { groupId: best.groupId, side: best.out >= best.in ? 'left' : 'right' });
    }
  }
  return attachment;
}

function rowKeyFor(node, attachment) {
  if (node.parentId) return `group:${node.parentId}`;
  const a = attachment.get(node.id);
  return a ? `group:${a.groupId}` : `solo:${node.id}`;
}

async function layoutGroupInternal(memberIds, internalEdges) {
  if (memberIds.length === 0) return { abs: {}, width: 0, height: 0 };
  // Same reasoning as the flat strategy's root graph (see direction.js):
  // feed ELK an already-acyclic edge set so a local cycle inside this
  // group can't flip which end reads as the start.
  const reversedSet = dfsReverseLocal(memberIds, internalEdges);
  const graph = {
    id: 'root',
    layoutOptions: baseLayoutOptions(),
    children: memberIds.map(leafElkNode),
    edges: internalEdges.map((e, i) => ({ id: `ie${i}`, ...elkEdgeEndpoints(e, i, reversedSet) })),
  };
  const { abs } = await runElk(graph);
  let minX = Infinity;
  let minY = Infinity;
  for (const id of memberIds) {
    minX = Math.min(minX, abs[id].x);
    minY = Math.min(minY, abs[id].y);
  }
  const norm = {};
  for (const id of memberIds) {
    norm[id] = { x: abs[id].x - minX, y: abs[id].y - minY };
  }
  return { norm };
}

// Greedy interval packing: push later entries down so no two attached nodes
// on the same side of the same row collide.
function packVertically(entries) {
  const sorted = entries.slice().sort((a, b) => a.desiredY - b.desiredY);
  let prevBottom = -Infinity;
  for (const e of sorted) {
    e.y = prevBottom === -Infinity ? e.desiredY : Math.max(e.desiredY, prevBottom + NODE_SIZE + NODE_GAP);
    prevBottom = e.y;
  }
  return sorted;
}

async function layoutRows(doc) {
  const byId = {};
  doc.nodes.forEach(n => (byId[n.id] = n));
  const members = groupMembersOf(doc);
  const attachment = attachUngrouped(doc, byId, members);

  const nodeOrderIndex = new Map(doc.nodes.map((n, i) => [n.id, i]));
  const rowFirstIndex = new Map();
  doc.nodes.forEach((n, i) => {
    const key = rowKeyFor(n, attachment);
    if (!rowFirstIndex.has(key)) rowFirstIndex.set(key, i);
  });
  const rowKeys = [...new Set(doc.nodes.map(n => rowKeyFor(n, attachment)))].filter(k => {
    // drop groups with no members at all (nothing to lay out)
    if (k.startsWith('group:')) return members.get(k.slice(6)).length > 0;
    return true;
  });
  const baseOrder = rowKeys.slice().sort((a, b) => rowFirstIndex.get(a) - rowFirstIndex.get(b));

  const metaEdgeSet = new Set();
  const metaEdges = [];
  for (const e of doc.edges) {
    const a = rowKeyFor(byId[e.from], attachment);
    const b = rowKeyFor(byId[e.to], attachment);
    if (a !== b) {
      const key = `${a}>${b}`;
      if (!metaEdgeSet.has(key)) {
        metaEdgeSet.add(key);
        metaEdges.push([a, b]);
      }
    }
  }

  const orderedRowKeys = topologicalOrder(rowKeys, baseOrder, metaEdges);

  const nodeBoxes = {};
  let cursorY = 0;

  for (const key of orderedRowKeys) {
    if (key.startsWith('solo:')) {
      const nodeId = key.slice(5);
      nodeBoxes[nodeId] = { x: 0, y: cursorY, w: NODE_SIZE, h: NODE_SIZE };
      cursorY = cursorY + NODE_SIZE + LABEL_RESERVE + ROW_GAP;
      continue;
    }

    const groupId = key.slice(6);
    const memberIds = members.get(groupId);
    const internalEdges = doc.edges.filter(
      e => byId[e.from].parentId === groupId && byId[e.to].parentId === groupId,
    );
    const { norm } = await layoutGroupInternal(memberIds, internalEdges);

    const leftAttached = [...attachment.entries()].filter(([, a]) => a.groupId === groupId && a.side === 'left');
    const rightAttached = [...attachment.entries()].filter(([, a]) => a.groupId === groupId && a.side === 'right');
    const leftWidth = leftAttached.length ? NODE_SIZE + RANK_GAP : 0;

    const groupOriginX = leftWidth;
    const groupOriginY = cursorY + GROUP_PADDING.top;

    let maxLocalY = 0;
    let maxLocalX = 0;
    for (const id of memberIds) {
      const x = groupOriginX + norm[id].x;
      const y = groupOriginY + norm[id].y;
      nodeBoxes[id] = { x: snap(x), y: snap(y), w: NODE_SIZE, h: NODE_SIZE };
      maxLocalX = Math.max(maxLocalX, norm[id].x);
      maxLocalY = Math.max(maxLocalY, norm[id].y);
    }
    const groupRightX = groupOriginX + maxLocalX + NODE_SIZE;

    // Attach nodes near the y of the group member they connect to most,
    // then resolve collisions by packing them vertically.
    function neighborY(ungroupedId, side) {
      const wantSource = side === 'left'; // left-attached nodes feed INTO the group
      const edge = doc.edges.find(e =>
        wantSource ? e.from === ungroupedId && byId[e.to].parentId === groupId
                   : e.to === ungroupedId && byId[e.from].parentId === groupId,
      );
      const neighborId = edge ? (wantSource ? edge.to : edge.from) : memberIds[0];
      return nodeBoxes[neighborId].y;
    }

    const leftEntries = leftAttached.map(([id]) => ({ id, desiredY: neighborY(id, 'left') }));
    packVertically(leftEntries).forEach(e => {
      nodeBoxes[e.id] = { x: 0, y: snap(e.y), w: NODE_SIZE, h: NODE_SIZE };
    });
    const rightEntries = rightAttached.map(([id]) => ({ id, desiredY: neighborY(id, 'right') }));
    packVertically(rightEntries).forEach(e => {
      nodeBoxes[e.id] = { x: snap(groupRightX + RANK_GAP), y: snap(e.y), w: NODE_SIZE, h: NODE_SIZE };
    });

    const groupMaxY = groupOriginY + maxLocalY + NODE_SIZE + LABEL_RESERVE + GROUP_PADDING.bottom;
    const attachedMaxY = Math.max(
      0,
      ...leftEntries.map(e => e.y + NODE_SIZE + LABEL_RESERVE),
      ...rightEntries.map(e => e.y + NODE_SIZE + LABEL_RESERVE),
    );
    cursorY = Math.max(groupMaxY, attachedMaxY) + ROW_GAP;
  }

  return { nodeBoxes };
}

module.exports = { layoutRows };
