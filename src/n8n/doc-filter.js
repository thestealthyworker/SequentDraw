// Layer filtering for the documentation export (renderSvg). See
// docs/design/n8n-visual-style.md "Documentation export (SVG with inline
// captions)": a figure shows exactly the layers it is about, nodes outside
// them are omitted (not stubbed), and the filtered subset is deliberately
// NOT re-validated for orphans — a node whose edges were all filtered out
// is still drawn, per the owner's decision recorded there.
//
// Takes an already-validated doc (validateDoc's return value) and returns
// a doc of the same shape (arrays of node/edge/group/note objects, the
// exact objects from the validated doc — never mutated, never re-created
// per the immutability rule) so it can be handed straight to
// layoutValidated() / the doc-export renderer without re-running
// validateDoc.

const { LAYER_VALUES } = require('./validate');

function layersOf(entity) {
  return entity.layers && entity.layers.length ? entity.layers : ['base'];
}

// Throws a plain Error (not ValidationError — this is a caller-usage
// mistake, an unknown layer name, not a problem with the document itself)
// naming every unknown layer at once.
function checkLayerNames(layers) {
  const unknown = layers.filter(l => !LAYER_VALUES.has(l));
  if (unknown.length) {
    throw new Error(
      `Unknown layer(s): ${unknown.join(', ')}. Valid layers are: ${[...LAYER_VALUES].join(', ')}.`,
    );
  }
}

// filterDocForLayers(validated, layers) -> filtered doc, same shape as a
// validateDoc() result. `layers` is the caller-chosen list of EXTRA layers
// to include beyond 'base', which is always included.
function filterDocForLayers(validated, layers) {
  const requested = Array.isArray(layers) ? layers : [];
  checkLayerNames(requested);
  const layerSet = new Set(['base', ...requested]);

  const includedNodes = validated.nodes.filter(n => layersOf(n).some(l => layerSet.has(l)));
  const includedNodeIds = new Set(includedNodes.map(n => n.id));

  const includedEdges = validated.edges.filter(e => includedNodeIds.has(e.from) && includedNodeIds.has(e.to));

  const includedGroups = validated.groups.filter(g => includedNodes.some(n => n.parentId === g.id));
  const includedGroupIds = new Set(includedGroups.map(g => g.id));

  const includedNotes = (validated.notes || [])
    .map(note => {
      if (!layersOf(note).some(l => layerSet.has(l))) return null;
      const attachTo = Array.isArray(note.attachTo) ? note.attachTo : [];
      if (!attachTo.length) return note; // map-level note: always kept as-is
      const filteredTargets = attachTo.filter(id => includedNodeIds.has(id) || includedGroupIds.has(id));
      if (!filteredTargets.length) return null; // every target excluded: drop the note entirely
      return filteredTargets.length === attachTo.length ? note : { ...note, attachTo: filteredTargets };
    })
    .filter(Boolean);

  return {
    title: validated.title,
    groups: includedGroups,
    nodes: includedNodes,
    edges: includedEdges,
    notes: includedNotes,
    tour: [],
  };
}

module.exports = { filterDocForLayers, layersOf, checkLayerNames };
