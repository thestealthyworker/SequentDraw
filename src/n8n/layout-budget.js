// Defends layoutFlat's ELK call against the pathological cost ELK's
// layered algorithm can hit on a dense, heavily-cyclic graph — see the
// header comment in layout-flat.js for how this is wired in and
// docs/design/n8n-visual-style.md / the fix commit for the profiling that
// found this.
//
// Root cause: direction.js hands ELK a graph that is already acyclic (it
// reverses exactly the edges that would close a cycle), so ELK's own
// cycle-breaking never runs. But nothing bounds how far apart in the
// resulting rank order two connected nodes can end up — a dense random
// digraph over N solo (ungrouped) nodes forces a near-total order across
// all of them, and edges whose endpoints land far apart in that order
// force ELK to insert a chain of dummy nodes at every intermediate layer.
// With elk.layered.nodePlacement.strategy: NETWORK_SIMPLEX (the option
// this renderer used for its quality on ordinary, mostly-local graphs
// like Medusa), the node-placement LP grows with that dummy-node count
// and goes from milliseconds to minutes well within the documented caps
// (100 nodes, 500 edges — see validate.js).
//
// estimateLayoutWork() computes a cheap (O(V+E), single pass, no
// unbounded loop regardless of how pathological the input is) proxy for
// that dummy-node count: a longest-path layering over the same
// ELK-oriented edge set layoutFlat is about to hand ELK, then the sum of
// each edge's (layer span - 1).
//
// Issue #20 (grouped documents): the original version of this estimator
// ignored group/container hierarchy entirely, on the theory that nesting
// only ever constrains ELK's placement further and so can only reduce its
// real work relative to the flat estimate, never increase it. Measurement
// proved that wrong. With `elk.hierarchyHandling: INCLUDE_CHILDREN` (see
// layout-flat.js), every edge whose endpoints sit in different containers
// forces ELK's hierarchical crossing-minimization/port-assignment machinery
// to route through those container boundaries — cost that scales with the
// *count* of such edges and the *number* of containers, almost independent
// of how far apart the edges' layers end up (the thing the flat estimate
// actually measures). A 50-groups-of-2/99-edge-chain/400-cross-group-edge
// document (the issue's reproduction) already measured bounded (this
// estimator said ~31,600) but still cost ~8.5s CPU per render because the
// bounded option set alone doesn't touch hierarchy cost. Worse, a much
// smaller document — 100 nodes in only 5 or 10 groups, 500 random edges,
// ~387-439 of them crossing a group boundary — measured a flat estimate of
// only 178-242 (*below* ELK_BOUNDED_OPTIONS_WORK, so it kept the original
// NETWORK_SIMPLEX + considerModelOrder options) yet cost 6.7s-20.5s CPU:
// proof the flat estimate alone can silently miss a hierarchy-driven
// blowup. See the fix commit for the full profiling.
//
// The fix has two parts:
//   1. This estimator now adds a hierarchy term — CROSS_GROUP_EDGE_WEIGHT
//      per edge whose endpoints have different parents (including
//      grouped-to-ungrouped) plus GROUP_COUNT_WEIGHT per declared group —
//      to the flat work above. It is still O(V+E): one extra parent-id
//      comparison per edge, one addition scaled by doc.groups.length.
//   2. layoutFlat additionally swaps `elk.hierarchyHandling` from
//      INCLUDE_CHILDREN to SEPARATE_CHILDREN whenever the (now
//      hierarchy-aware) estimate crosses into bounded territory —
//      SEPARATE_CHILDREN lays out each container's contents independently
//      instead of solving one hierarchy-wide compound graph, which is what
//      actually removes the cost (measured 5x-40x faster than INCLUDE_
//      CHILDREN across every grouped stress case, bounded or not, group
//      count 5 through 50). This renderer draws every edge itself (see
//      layout-flat.js's header) rather than using ELK's own edge routing,
//      so SEPARATE_CHILDREN's less-globally-optimal node placement never
//      produces an incorrect diagram — obstacle-avoiding routing in
//      routing.js still finds a clean path regardless of which layout
//      ELK produced.
//
// Two thresholds, both calibrated against real measurements (see the fix
// commit messages for the numbers):
//   - ELK_BOUNDED_OPTIONS_WORK: above this, layoutFlat swaps in the
//     bounded ELK option set (elk-helpers.js's boundedLayoutOptions) —
//     nodePlacement.strategy: SIMPLE, no considerModelOrder, hierarchy
//     handling SEPARATE_CHILDREN — which stays fast on every dense/cyclic
//     and dense/grouped shape tested up to the caps. Medusa's own
//     hierarchy-aware estimate (52 flat + 15 cross-group edges * 2 + 5
//     groups * 4 = 102) sits far below this, so it keeps the exact
//     options (and byte-identical output) it always used.
//   - MAX_LAYOUT_WORK_UNITS: above this, we refuse to call ELK at all.
//     The largest estimate achievable within the current caps (500
//     duplicate max-span edges laid over a 100-node chain, all of them
//     cross-group, spread across the 50-group cap) measures flat ~39,300
//     + hierarchy terms ~1,100 = ~40,400 and still finishes in
//     single-digit seconds under the bounded options, so this is well
//     clear of anything the caps allow today — it exists as a backstop
//     against a future raised cap, a validation bypass, or a shape this
//     fix's measurements didn't anticipate, not as something normal input
//     should ever reach.
const ELK_BOUNDED_OPTIONS_WORK = 300;
const MAX_LAYOUT_WORK_UNITS = 60000;

// Per-cross-group-boundary-edge and per-declared-group additions to the
// flat work estimate — see the header above for the measurements that
// justify these. Kept small and linear (not, say, scaled by flatWork)
// so the estimate stays a cheap, easily-reasoned-about O(V+E) pass.
const CROSS_GROUP_EDGE_WEIGHT = 2;
const GROUP_COUNT_WEIGHT = 4;

class LayoutError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
  }
}

// `orientedEdges` is the same { sources: [id], targets: [id] } shape
// layoutFlat builds for ELK (already flipped per the reversed-edge set),
// restricted to the two endpoints layering cares about.
//
// `hierarchy`, when passed, is `{ parentIdOf: Map<nodeId, groupId|null>,
// groupCount: number }` — layoutFlat builds it from the same doc this
// call is about to hand ELK. Omitting it (or passing a doc with no
// groups) reproduces the pre-hierarchy-aware flat estimate exactly, since
// every node's parent is then null/undefined and no edge crosses a group
// boundary.
function estimateLayoutWork(nodeIds, orientedEdges, hierarchy) {
  const indegree = new Map(nodeIds.map(id => [id, 0]));
  const adjacency = new Map(nodeIds.map(id => [id, []]));
  orientedEdges.forEach(({ sources, targets }) => {
    const from = sources[0];
    const to = targets[0];
    if (!adjacency.has(from) || !adjacency.has(to)) return; // defensive: unknown endpoint
    adjacency.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  });

  // Longest-path layering (Kahn's algorithm variant): each node's layer
  // is 1 + the max layer of its predecessors, 0 for sources. Every node
  // is dequeued at most once, so this is O(V+E) even on an adversarial
  // input — a residual cycle direction.js's reversal didn't fully break
  // (e.g. a self-loop) just leaves the node(s) it touches at layer 0,
  // which only ever under-counts the work estimate, never loops.
  const layer = new Map(nodeIds.map(id => [id, 0]));
  const queue = nodeIds.filter(id => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of adjacency.get(id)) {
      if (layer.get(next) < layer.get(id) + 1) layer.set(next, layer.get(id) + 1);
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  let work = 0;
  orientedEdges.forEach(({ sources, targets }) => {
    const from = sources[0];
    const to = targets[0];
    if (!layer.has(from) || !layer.has(to)) return;
    const span = Math.abs(layer.get(to) - layer.get(from));
    work += Math.max(0, span - 1);
  });

  if (hierarchy) {
    const { parentIdOf, groupCount } = hierarchy;
    let crossGroupEdges = 0;
    orientedEdges.forEach(({ sources, targets }) => {
      const from = sources[0];
      const to = targets[0];
      const fromParent = parentIdOf.get(from) || null;
      const toParent = parentIdOf.get(to) || null;
      if (fromParent !== toParent) crossGroupEdges++;
    });
    work += crossGroupEdges * CROSS_GROUP_EDGE_WEIGHT + (groupCount || 0) * GROUP_COUNT_WEIGHT;
  }

  return work;
}

module.exports = {
  estimateLayoutWork,
  LayoutError,
  ELK_BOUNDED_OPTIONS_WORK,
  MAX_LAYOUT_WORK_UNITS,
  CROSS_GROUP_EDGE_WEIGHT,
  GROUP_COUNT_WEIGHT,
};
