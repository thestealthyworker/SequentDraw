// ELK plumbing for the flat layout strategy. Only node/container
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

// `bounded` (see layout-budget.js) swaps in an ELK option set measured to
// stay fast on dense/cyclic graphs, at the cost of the quality NETWORK_SIMPLEX
// placement + model-order-aware crossing minimization gives on ordinary,
// mostly-local graphs (every real fixture this renderer has, e.g. Medusa —
// see the fix commit for the profiling that found this). layoutFlat only
// passes bounded: true once the graph's estimated ELK work crosses
// ELK_BOUNDED_OPTIONS_WORK, so an ordinary document's output is completely
// unaffected: same options object as before this parameter existed.
function baseLayoutOptions(extra, bounded) {
  const opts = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.json.edgeCoords': 'ROOT',
    'elk.spacing.nodeNode': String(NODE_GAP),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_GAP),
    'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '16',
    // SIMPLE is a single linear pass (no LP solve), so its cost tracks the
    // dummy-node count directly instead of blowing up on it the way
    // NETWORK_SIMPLEX's optimisation does — see layout-budget.js.
    'elk.layered.nodePlacement.strategy': bounded ? 'SIMPLE' : 'NETWORK_SIMPLEX',
  };
  if (!bounded) {
    // We already hand ELK a pre-reversed, acyclic edge set (see
    // direction.js), so its own cycle-breaking never has to act; this
    // just keeps rank/crossing-minimization decisions aligned with the
    // doc's declared node/edge order wherever ELK still has a choice.
    // Measured to compound with NETWORK_SIMPLEX's cost on dense/cyclic
    // graphs, so the bounded path drops it too.
    opts['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
  }
  return Object.assign(opts, extra || {});
}

// `nodeGap` defaults to the interactive NODE_GAP; the doc-export layout
// pass (src/n8n/doc-layout.js) passes a larger value so ELK's own initial
// placement already leaves room for the tallest caption in play, instead
// of relying solely on the post-layout overlap-resolution sweep in
// layout.js. Passing the default value reproduces the exact same options
// object as before this parameter existed.
function containerLayoutOptions(nodeGap) {
  return {
    'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
    'elk.spacing.nodeNode': String(nodeGap == null ? NODE_GAP : nodeGap),
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
  // Object.create(null), not {}: a node or group id is author-controlled
  // and ID_RE (validate.js) allows "__proto__" as a legal id. Keying a
  // plain {} by it would silently reassign the object's prototype on
  // write instead of storing that id's position as an own property, and
  // every later `abs[id]` lookup for a DIFFERENT id would then resolve
  // through the polluted prototype instead of coming up empty.
  const abs = Object.create(null);
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
