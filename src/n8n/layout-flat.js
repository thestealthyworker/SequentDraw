// Strategy "flat": one ELK layered pass across the whole graph, direction
// RIGHT, groups as real containers via hierarchyHandling INCLUDE_CHILDREN.

const { snap, NODE_SIZE } = require('./constants');
const { baseLayoutOptions, containerLayoutOptions, leafElkNode, runElk } = require('./elk-helpers');

async function layoutFlat(doc) {
  const containers = new Map();
  doc.groups.forEach(g => {
    containers.set(g.id, {
      id: g.id,
      labels: [{ text: g.label }],
      children: [],
      layoutOptions: containerLayoutOptions(),
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

  const graph = {
    id: 'root',
    layoutOptions: baseLayoutOptions({ 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }),
    children: [...containers.values(), ...roots],
    edges: doc.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const { abs } = await runElk(graph);

  const nodeBoxes = {};
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
