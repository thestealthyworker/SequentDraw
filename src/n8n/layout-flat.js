// One ELK layered pass across the whole graph, direction RIGHT, groups as
// real containers via hierarchyHandling INCLUDE_CHILDREN.

const { snap, NODE_SIZE, NODE_GAP, LABEL_RESERVE } = require('./constants');
const { baseLayoutOptions, containerLayoutOptions, leafElkNode, runElk } = require('./elk-helpers');
const { computeReversedEdgeSet, elkEdgeEndpoints } = require('./direction');

// `opts.labelReserve`, when larger than the interactive LABEL_RESERVE
// (the doc-export layout pass passes the tallest caption's reserve — see
// doc-layout.js), grows the perpendicular-to-flow ELK spacing by the same
// amount, so nodes stacked in one rank already leave room for a caption
// below the shorter one instead of relying only on the post-layout
// overlap sweep in layout.js. Omitting opts (the interactive path) keeps
// the exact same spacing as before this parameter existed.
async function layoutFlat(doc, opts = {}) {
  const labelReserve = opts.labelReserve == null ? LABEL_RESERVE : opts.labelReserve;
  const nodeGap = NODE_GAP + Math.max(0, labelReserve - LABEL_RESERVE);

  const containers = new Map();
  doc.groups.forEach(g => {
    containers.set(g.id, {
      id: g.id,
      labels: [{ text: g.label }],
      children: [],
      layoutOptions: containerLayoutOptions(nodeGap),
    });
  });

  const roots = [];
  doc.nodes.forEach(n => {
    const child = leafElkNode(n.id);
    if (n.parentId && containers.has(n.parentId)) {
      containers.get(n.parentId).children.push(child);
    } else {
      roots.push(child);
    }
  });

  // Feed ELK a graph that is already acyclic for rank-assignment purposes:
  // reverse only the edges that actually close a cycle (preferring dashed
  // ones), so ELK's own rank ordering follows the doc's declared reading
  // order instead of an arbitrary greedy cycle-break that can put the
  // entry group on the wrong side of the canvas.
  const reversedSet = computeReversedEdgeSet(doc.nodes, doc.edges);

  const graph = {
    id: 'root',
    layoutOptions: baseLayoutOptions({ 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': String(nodeGap) }),
    children: [...containers.values(), ...roots],
    edges: doc.edges.map((e, i) => ({ id: `e${i}`, ...elkEdgeEndpoints(e, i, reversedSet) })),
  };

  const { abs } = await runElk(graph);

  // Object.create(null): same __proto__-as-a-legal-id hazard as abs in
  // elk-helpers.js, keyed by node id here.
  const nodeBoxes = Object.create(null);
  doc.nodes.forEach(n => {
    const box = abs[n.id];
    nodeBoxes[n.id] = { x: snap(box.x), y: snap(box.y), w: NODE_SIZE, h: NODE_SIZE };
  });

  // Frame boxes are derived from the final (snapped) node positions rather
  // than ELK's own container box, so padding stays exact after snapping —
  // see computeFrameBoxes in layout.js.
  return { nodeBoxes };
}

module.exports = { layoutFlat };
