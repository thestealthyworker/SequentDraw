// Kahn's algorithm topological sort with cycle-breaking by first
// appearance: when nothing has in-degree 0 (a cycle), the earliest key in
// `baseOrder` is picked anyway and its outgoing edges are treated as
// satisfied. Used by direction.js for group-level edge-reversal order.
function topologicalOrder(keys, baseOrder, metaEdges) {
  const indegree = new Map(keys.map(k => [k, 0]));
  const adj = new Map(keys.map(k => [k, new Set()]));
  for (const [a, b] of metaEdges) {
    if (a === b || !adj.has(a) || !adj.has(b)) continue;
    if (!adj.get(a).has(b)) {
      adj.get(a).add(b);
      indegree.set(b, indegree.get(b) + 1);
    }
  }
  const rank = new Map(baseOrder.map((k, i) => [k, i]));
  const remaining = new Set(keys);
  const byBaseOrder = list => list.slice().sort((x, y) => (rank.get(x) ?? 1e9) - (rank.get(y) ?? 1e9));
  const result = [];
  while (remaining.size) {
    const ready = byBaseOrder([...remaining].filter(k => indegree.get(k) === 0));
    const pick = ready.length ? ready[0] : byBaseOrder([...remaining])[0]; // cycle break
    result.push(pick);
    remaining.delete(pick);
    for (const succ of adj.get(pick)) {
      if (remaining.has(succ)) indegree.set(succ, Math.max(0, indegree.get(succ) - 1));
    }
  }
  return result;
}

module.exports = { topologicalOrder };
