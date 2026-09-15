// Computes a feedback-arc set — edges to feed ELK reversed, purely for rank
// assignment — so the graph ELK ranks is acyclic and oriented the way the
// doc actually reads, not however ELK's own greedy cycle-breaking happens
// to land. Medusa's group graph has several genuine cycles (e.g. g_core <->
// g_entry, g_core <-> g_ship): ELK's default reversed edges that put the
// process's real entry group at the far right of the canvas instead of the
// left.
//
// This runs in two passes:
//
//   1. Group level: order groups (and ungrouped nodes, each its own unit)
//      with the same topological-sort-plus-cycle-break used to stack rows
//      in the "rows" strategy (see topo.js), then reverse any cross-group
//      edge that points from a later group to an earlier one. Reasoning
//      about the coarse group graph rather than individual nodes matters
//      here — Medusa has an edge from deep inside the pipeline back to the
//      `customer` node (a notification), and a naive node-by-node DFS can
//      end up treating that single edge as evidence that the *group*
//      it's declared in comes first, which is backwards. The group graph
//      doesn't have that problem: it orders on the group's overall
//      in/out edge balance, not on which one node inside it a traversal
//      happens to reach first.
//   2. Node level, scoped to one group at a time: a DFS-based
//      back-edge search (visiting non-dashed edges before dashed ones, so
//      a dashed return/retry edge is preferentially the one reversed) for
//      whatever local cycles remain inside a single group's own edges.

const { topologicalOrder } = require('./topo');

function groupKeyOf(node) {
  return node.parentId ? `group:${node.parentId}` : `solo:${node.id}`;
}

// DFS back-edge search over a local node id list + a local edge list
// (each edge referencing those same ids). Returns the set of local edge
// indices that close a cycle.
function dfsReverseLocal(nodeIds, localEdges) {
  const adjacency = new Map(nodeIds.map(id => [id, []]));
  localEdges.forEach((e, i) => {
    if (adjacency.has(e.from)) adjacency.get(e.from).push(i);
  });
  adjacency.forEach(list => {
    list.sort((a, b) => (localEdges[a].type === 'dashed' ? 1 : 0) - (localEdges[b].type === 'dashed' ? 1 : 0));
  });

  const UNVISITED = 0;
  const IN_STACK = 1;
  const DONE = 2;
  const state = new Map(nodeIds.map(id => [id, UNVISITED]));
  const reversed = new Set();

  function dfs(id) {
    state.set(id, IN_STACK);
    for (const edgeIdx of adjacency.get(id) || []) {
      const target = localEdges[edgeIdx].to;
      const targetState = state.get(target);
      if (targetState === undefined) continue;
      if (targetState === IN_STACK) reversed.add(edgeIdx);
      else if (targetState === UNVISITED) dfs(target);
    }
    state.set(id, DONE);
  }

  nodeIds.forEach(id => {
    if (state.get(id) === UNVISITED) dfs(id);
  });
  return reversed;
}

function computeReversedEdgeSet(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const keyOf = id => groupKeyOf(byId.get(id));

  const keys = [...new Set(nodes.map(n => groupKeyOf(n)))];
  // Tie-break / cycle-break priority comes from each group's first mention
  // in the EDGE list, not the node list: nodes are typically declared
  // grouped together for readability (all of one group's members in a
  // block), which does not track the actual flow order, whereas an edge
  // list tends to be authored roughly in the order the flow happens.
  const firstIndex = new Map();
  edges.forEach((e, i) => {
    const a = keyOf(e.from);
    const b = keyOf(e.to);
    if (!firstIndex.has(a)) firstIndex.set(a, i);
    if (!firstIndex.has(b)) firstIndex.set(b, i);
  });
  keys.forEach(k => {
    if (!firstIndex.has(k)) firstIndex.set(k, Infinity);
  });
  const baseOrder = keys.slice().sort((a, b) => firstIndex.get(a) - firstIndex.get(b));

  const metaEdgeSet = new Set();
  const metaEdges = [];
  edges.forEach(e => {
    const a = keyOf(e.from);
    const b = keyOf(e.to);
    if (a !== b) {
      const k = `${a}>${b}`;
      if (!metaEdgeSet.has(k)) {
        metaEdgeSet.add(k);
        metaEdges.push([a, b]);
      }
    }
  });
  const order = topologicalOrder(keys, baseOrder, metaEdges);
  const rank = new Map(order.map((k, i) => [k, i]));

  const reversed = new Set();
  edges.forEach((e, i) => {
    const a = keyOf(e.from);
    const b = keyOf(e.to);
    if (a !== b && rank.get(a) > rank.get(b)) reversed.add(i);
  });

  // Local cycles inside a single group's own edges.
  const byGroup = new Map();
  edges.forEach((e, i) => {
    const a = keyOf(e.from);
    const b = keyOf(e.to);
    if (a === b && a.startsWith('group:')) {
      if (!byGroup.has(a)) byGroup.set(a, []);
      byGroup.get(a).push(i);
    }
  });
  byGroup.forEach((edgeIdxs, groupKey) => {
    const memberIds = nodes.filter(n => groupKeyOf(n) === groupKey).map(n => n.id);
    const localEdges = edgeIdxs.map(i => edges[i]);
    const localReversed = dfsReverseLocal(memberIds, localEdges);
    localReversed.forEach(localIdx => reversed.add(edgeIdxs[localIdx]));
  });

  return reversed;
}

// Builds the {sources, targets} pair ELK should see for rank-assignment
// purposes: reversed for edges in `reversedSet`, true direction otherwise.
// The caller keeps using the edge's real `from`/`to` for everything else
// (handles, arrowheads, the backward-detour test) — only ELK's internal
// ranking is fed the flipped pair.
function elkEdgeEndpoints(edge, edgeIndex, reversedSet) {
  return reversedSet.has(edgeIndex) ? { sources: [edge.to], targets: [edge.from] } : { sources: [edge.from], targets: [edge.to] };
}

module.exports = { computeReversedEdgeSet, elkEdgeEndpoints, dfsReverseLocal };
