// ELK plumbing shared by both layout strategies. Only node/container
// positions are used — edge paths are computed ourselves (see geometry.js
// and layout.js) so the visual grammar in docs/design/n8n-visual-style.md is
// followed exactly rather than however ELK's own router would draw it.
//
// Mechanics carried over from docs/HANDOVER.md (findings 2-4):
//   - elk.json.edgeCoords: 'ROOT' avoids the mixed-reference-frame trap.
//   - The ELK node is the node's own 96x96 shape; label space is reserved
//     via elk.spacing.nodeNode, not via elk.margins (ignored in elkjs 0.12).
//   - Spacing options are set on every container's layoutOptions; they do
//     not inherit from the root graph.

const ELK = require('elkjs');
const { NODE_SIZE, RANK_GAP, NODE_GAP, GROUP_PADDING } = require('./constants');

const elk = new ELK();

function baseLayoutOptions(extra) {
  return Object.assign(
    {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.json.edgeCoords': 'ROOT',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_GAP),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // We already hand ELK a pre-reversed, acyclic edge set (see
      // direction.js), so its own cycle-breaking never has to act; this
      // just keeps rank/crossing-minimization decisions aligned with the
      // doc's declared node/edge order wherever ELK still has a choice.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    extra || {},
  );
}

function containerLayoutOptions() {
  return {
    'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
    'elk.spacing.nodeNode': String(NODE_GAP),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_GAP),
  };
}

function leafElkNode(id) {
  return { id, width: NODE_SIZE, height: NODE_SIZE, layoutOptions: { 'elk.portConstraints': 'FREE' } };
}

// Runs ELK over a graph and walks the result to absolute (root-relative)
// positions, since child coordinates are parent-relative in elkjs output.
async function runElk(graph) {
  const result = await elk.layout(graph);
  const abs = {};
  (function walk(node, ox, oy) {
    (node.children || []).forEach(child => {
      const x = ox + child.x;
      const y = oy + child.y;
      abs[child.id] = { x, y, w: child.width, h: child.height };
      walk(child, x, y);
    });
  })(result, 0, 0);
  return { abs, width: result.width, height: result.height };
}

module.exports = {
  baseLayoutOptions,
  containerLayoutOptions,
  leafElkNode,
  runElk,
};
