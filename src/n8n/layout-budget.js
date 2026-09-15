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
// each edge's (layer span - 1). It ignores group/container hierarchy —
// a deliberate over-approximation, since nesting only ever constrains
// ELK's placement further and so can only reduce its real work relative
// to this flat estimate, never increase it.
//
// Two thresholds, both calibrated against real measurements (see the fix
// commit message for the numbers):
//   - ELK_BOUNDED_OPTIONS_WORK: above this, layoutFlat swaps in the
//     bounded ELK option set (elk-helpers.js's boundedLayoutOptions) —
//     nodePlacement.strategy: SIMPLE, no considerModelOrder — which
//     stays fast on every dense/cyclic shape tested up to the caps.
//     Medusa's own estimate (~52) sits far below this, so it keeps the
//     exact options (and byte-identical output) it always used.
//   - MAX_LAYOUT_WORK_UNITS: above this, we refuse to call ELK at all.
//     The largest estimate achievable within the current caps (500
//     duplicate max-span edges laid over a 100-node chain) measures
//     ~39,300 and still finishes in single-digit seconds under the
//     bounded options, so this is well clear of anything the caps allow
//     today — it exists as a backstop against a future raised cap, a
//     validation bypass, or a shape this fix's measurements didn't
//     anticipate, not as something normal input should ever reach.
const ELK_BOUNDED_OPTIONS_WORK = 300;
const MAX_LAYOUT_WORK_UNITS = 60000;

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
function estimateLayoutWork(nodeIds, orientedEdges) {
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
  return work;
}

module.exports = { estimateLayoutWork, LayoutError, ELK_BOUNDED_OPTIONS_WORK, MAX_LAYOUT_WORK_UNITS };
