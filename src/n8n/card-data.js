// buildCardData(doc, layout) -> { nodes: [...], edges: [...] }
//
// Pure, testable summaries for the details card (docs/design/n8n-visual-style.md
// "Details card"). No DOM, no string escaping for markup — render-shell.js
// embeds the result as a JSON literal (escaped there, once, for the inline
// <script>) and the viewer script reads it back with JSON.parse. Takes the
// already-validated doc and the layout (for deterministic ordering only —
// node/edge content itself never depends on computed geometry).
//
// Connection lists are derived from doc.edges, not authored separately, so
// every map gets "Receives from" / "Sends to" even when no edge carries a
// `description`.

const { layersOf } = require('./render-svg');

// Deterministic ordering: by layout position, left to right then top to
// bottom (docs/design/n8n-visual-style.md "Card data"). Falls back to id
// comparison so two nodes placed at the exact same box (never happens after
// layout.js's overlap resolution, but kept for defence) still order the
// same way every run.
function byPosition(nodeBoxes) {
  return (aId, bId) => {
    const a = nodeBoxes[aId];
    const b = nodeBoxes[bId];
    const ax = a ? a.x : Infinity;
    const ay = a ? a.y : Infinity;
    const bx = b ? b.x : Infinity;
    const by = b ? b.y : Infinity;
    if (ax !== bx) return ax - bx;
    if (ay !== by) return ay - by;
    if (aId === bId) return 0;
    return aId < bId ? -1 : 1;
  };
}

function buildCardData(doc, layout) {
  const nodeBoxes = (layout && layout.nodeBoxes) || {};
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const edges = Array.isArray(doc.edges) ? doc.edges : [];
  const groups = Array.isArray(doc.groups) ? doc.groups : [];

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const groupById = new Map(groups.map(g => [g.id, g]));
  const positionCompare = byPosition(nodeBoxes);

  const incomingOf = new Map();
  const outgoingOf = new Map();
  nodes.forEach(n => {
    incomingOf.set(n.id, []);
    outgoingOf.set(n.id, []);
  });
  edges.forEach((e, i) => {
    if (outgoingOf.has(e.from)) outgoingOf.get(e.from).push(i);
    if (incomingOf.has(e.to)) incomingOf.get(e.to).push(i);
  });

  function connectionEntry(edgeIndex, otherId) {
    const e = edges[edgeIndex];
    const other = nodeById.get(otherId);
    return {
      nodeId: otherId,
      label: other ? other.label : otherId,
      edgeDescription: e.description || null,
      condition: e.condition || null,
      type: e.type || 'solid',
    };
  }

  function sortedConnections(edgeIndexes, endpointOf) {
    return edgeIndexes
      .slice()
      .sort((a, b) => {
        const cmp = positionCompare(endpointOf(edges[a]), endpointOf(edges[b]));
        return cmp !== 0 ? cmp : a - b;
      })
      .map(i => connectionEntry(i, endpointOf(edges[i])));
  }

  const orderedNodeIds = nodes.map(n => n.id).sort(positionCompare);

  const cardNodes = orderedNodeIds.map(id => {
    const n = nodeById.get(id);
    const group = n.parentId ? groupById.get(n.parentId) : null;
    return {
      id: n.id,
      label: n.label,
      sublabel: n.sublabel || null,
      kind: n.kind,
      group: group ? group.label : null,
      layers: layersOf(n),
      status: n.status || 'confirmed',
      description: n.description || null,
      prompt: n.status === 'open' && n.prompt ? n.prompt : null,
      rationale: n.status === 'suggested' && n.rationale ? n.rationale : null,
      link: n.link || null,
      receivesFrom: sortedConnections(incomingOf.get(id) || [], e => e.from),
      sendsTo: sortedConnections(outgoingOf.get(id) || [], e => e.to),
    };
  });

  const cardEdges = edges.map((e, i) => {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    return {
      index: i,
      from: e.from,
      to: e.to,
      fromLabel: from ? from.label : e.from,
      toLabel: to ? to.label : e.to,
      type: e.type || 'solid',
      condition: e.condition || null,
      description: e.description || null,
    };
  });

  return { nodes: cardNodes, edges: cardEdges };
}

module.exports = { buildCardData };
