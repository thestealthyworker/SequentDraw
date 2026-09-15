// Minimal input validation: edge endpoints and parentIds must exist.
// Fails loudly with a clear Error, per docs/SPEC.md invariants.

function validateDoc(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('SequentDraw doc must be an object');
  }
  if (!Array.isArray(doc.nodes)) {
    throw new Error('SequentDraw doc.nodes must be an array');
  }
  if (!Array.isArray(doc.edges)) {
    throw new Error('SequentDraw doc.edges must be an array');
  }
  const groups = Array.isArray(doc.groups) ? doc.groups : [];

  const groupIds = new Set(groups.map(g => g.id));
  const nodeIds = new Set(doc.nodes.map(n => n.id));

  const dupGroup = groups.map(g => g.id).find((id, i, arr) => arr.indexOf(id) !== i);
  if (dupGroup) throw new Error(`Duplicate group id: "${dupGroup}"`);

  const dupNode = doc.nodes.map(n => n.id).find((id, i, arr) => arr.indexOf(id) !== i);
  if (dupNode) throw new Error(`Duplicate node id: "${dupNode}"`);

  for (const n of doc.nodes) {
    if (n.parentId != null && !groupIds.has(n.parentId)) {
      throw new Error(`Node "${n.id}" has parentId "${n.parentId}" which is not a declared group`);
    }
  }

  for (const [i, e] of doc.edges.entries()) {
    if (!nodeIds.has(e.from)) {
      throw new Error(`Edge #${i} has "from": "${e.from}" which is not a declared node`);
    }
    if (!nodeIds.has(e.to)) {
      throw new Error(`Edge #${i} has "to": "${e.to}" which is not a declared node`);
    }
  }

  return { groups, nodes: doc.nodes, edges: doc.edges };
}

module.exports = { validateDoc };
