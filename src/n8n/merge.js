// Applies a small patch to an existing workflow document:
//
//   {
//     "nodes": [ ...nodes to add ],
//     "edges": [ ...edges to add ],
//     "notes": [ ...notes to add ],
//     "tour": [ ...the whole tour ],        // REPLACES the tour; [] removes it
//     "remove": {
//       "nodes": ["node id", ...],          // also removes every edge touching it
//       "edges": [{ "from": "id", "to": "id" }, ...],  // every edge from -> to
//       "notes": ["note id", ...]
//     }
//   }
//
// Why it exists: a skill reviewing or suggesting against an existing map used
// to re-type the whole document into one shell string to hand it to the CLI.
// At the size of a real map (the 23KB Medusa example) that was not reliable:
// one raw apostrophe in a copied label broke the quoting and the command was
// refused. With a patch, the model writes only what it adds or removes.
//
// Removals run first, then additions, so a node can be replaced under the same
// id (how a suggestion is accepted). An added id that is already taken by a
// node, group or note -- in the base after removals, or earlier in the patch --
// is an error, never an overwrite. Removing something that is not there is an
// error too. Any error means no document: `{ doc: null, errors }`.
//
// A tour is replaced whole rather than merged step by step: it is one ordered
// narrative, and a partial merge of numbered steps could leave two step 3s or
// a gap. `"tour": []` removes it.
//
// This checks only what the merge itself needs. Everything else about the
// merged document (field shapes, references, caps) is validateDoc()'s job,
// which the CLI runs on the result. Pure: neither input is mutated.

const ADD_KEYS = ['nodes', 'edges', 'notes'];
const REMOVE_KEYS = ['nodes', 'edges', 'notes'];
const TOP_KEYS = [...ADD_KEYS, 'tour', 'remove'];

// Same caps as a whole document (src/n8n/validate.js), applied to each patch
// list before any of its items is read.
const PATCH_LIMITS = Object.freeze({ nodes: 100, edges: 500, notes: 20, tour: 50 });

const ECHO_MAX_LENGTH = 60;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function echo(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const text = s === undefined ? String(value) : s;
  return text.length > ECHO_MAX_LENGTH ? `${text.slice(0, ECHO_MAX_LENGTH)}…` : text;
}

function fail(errors) {
  return { doc: null, errors };
}

function checkList(list, path, limit, isItem, itemDescription, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    errors.push({ path, code: 'merge-invalid-list', message: `--merge: ${path} must be an array.` });
    return [];
  }
  if (list.length > limit) {
    errors.push({ path, code: 'merge-too-many', message: `--merge: ${path} has ${list.length} entries; at most ${limit} are allowed.` });
    return [];
  }
  list.forEach((item, i) => {
    if (!isItem(item)) {
      errors.push({ path: `${path}/${i}`, code: 'merge-invalid-item', message: `--merge: ${path}/${i} must be ${itemDescription}.` });
    }
  });
  return list;
}

const isId = v => typeof v === 'string' && v.length > 0;
const isEdgeRef = v => isPlainObject(v) && isId(v.from) && isId(v.to);

function checkShape(base, patch) {
  const errors = [];
  if (!isPlainObject(base) || !Array.isArray(base.nodes) || !Array.isArray(base.edges)) {
    errors.push({ path: '/', code: 'merge-invalid-base', message: '--merge: the base document must be an object with "nodes" and "edges" arrays.' });
    return errors;
  }
  if (!isPlainObject(patch)) {
    errors.push({ path: '/', code: 'merge-invalid-patch', message: '--merge: the patch must be a JSON object with any of: nodes, edges, notes, tour, remove.' });
    return errors;
  }
  for (const key of Object.keys(patch)) {
    if (!TOP_KEYS.includes(key)) {
      errors.push({ path: `/${key}`, code: 'merge-unknown-key', message: `--merge: unknown patch key "${echo(key)}"; the patch takes nodes, edges, notes, tour, remove.` });
    }
  }
  if (patch.remove !== undefined && !isPlainObject(patch.remove)) {
    errors.push({ path: '/remove', code: 'merge-invalid-list', message: '--merge: /remove must be an object with any of: nodes, edges, notes.' });
  } else if (patch.remove !== undefined) {
    for (const key of Object.keys(patch.remove)) {
      if (!REMOVE_KEYS.includes(key)) {
        errors.push({ path: `/remove/${key}`, code: 'merge-unknown-key', message: `--merge: unknown remove key "${echo(key)}"; remove takes nodes, edges, notes.` });
      }
    }
  }
  for (const key of ADD_KEYS) {
    checkList(patch[key], `/${key}`, PATCH_LIMITS[key], isPlainObject, 'an object', errors);
  }
  checkList(patch.tour, '/tour', PATCH_LIMITS.tour, isPlainObject, 'a tour step object', errors);
  if (isPlainObject(patch.remove)) {
    checkList(patch.remove.nodes, '/remove/nodes', PATCH_LIMITS.nodes, isId, 'a node id', errors);
    checkList(patch.remove.edges, '/remove/edges', PATCH_LIMITS.edges, isEdgeRef, 'an object with "from" and "to" node ids', errors);
    checkList(patch.remove.notes, '/remove/notes', PATCH_LIMITS.notes, isId, 'a note id', errors);
  }
  return errors;
}

function idsOf(list) {
  return (Array.isArray(list) ? list : []).filter(item => isPlainObject(item) && typeof item.id === 'string').map(item => item.id);
}

function applyPatch(base, patch) {
  const shapeErrors = checkShape(base, patch);
  if (shapeErrors.length > 0) return fail(shapeErrors);

  const remove = patch.remove || {};
  const removeNodes = remove.nodes || [];
  const removeEdges = remove.edges || [];
  const removeNotes = remove.notes || [];
  const baseNotes = Array.isArray(base.notes) ? base.notes : [];
  const errors = [];

  const nodeIds = new Set(idsOf(base.nodes));
  removeNodes.forEach((id, i) => {
    if (!nodeIds.has(id)) {
      errors.push({ path: `/remove/nodes/${i}`, code: 'merge-remove-unknown-node', message: `--merge: "${echo(id)}" is not a node in the base document; nothing to remove.` });
    }
  });
  removeEdges.forEach((ref, i) => {
    if (!base.edges.some(e => isPlainObject(e) && e.from === ref.from && e.to === ref.to)) {
      errors.push({ path: `/remove/edges/${i}`, code: 'merge-remove-unknown-edge', message: `--merge: there is no edge "${echo(ref.from)}" -> "${echo(ref.to)}" in the base document; nothing to remove.` });
    }
  });
  const noteIds = new Set(idsOf(baseNotes));
  removeNotes.forEach((id, i) => {
    if (!noteIds.has(id)) {
      errors.push({ path: `/remove/notes/${i}`, code: 'merge-remove-unknown-note', message: `--merge: "${echo(id)}" is not a note in the base document; nothing to remove.` });
    }
  });

  const removedNodes = new Set(removeNodes);
  const removedNotes = new Set(removeNotes);
  const edgeRemoved = e =>
    isPlainObject(e) &&
    (removedNodes.has(e.from) || removedNodes.has(e.to) || removeEdges.some(ref => ref.from === e.from && ref.to === e.to));

  const keptNodes = base.nodes.filter(n => !(isPlainObject(n) && removedNodes.has(n.id)));
  const keptEdges = base.edges.filter(e => !edgeRemoved(e));
  const keptNotes = baseNotes.filter(n => !(isPlainObject(n) && removedNotes.has(n.id)));

  const taken = new Set([...idsOf(keptNodes), ...idsOf(base.groups), ...idsOf(keptNotes)]);
  for (const key of ['nodes', 'notes']) {
    (patch[key] || []).forEach((item, i) => {
      if (typeof item.id !== 'string') return; // validateDoc reports a missing or invalid id
      if (taken.has(item.id)) {
        errors.push({ path: `/${key}/${i}/id`, code: 'merge-duplicate-id', message: `--merge: id "${echo(item.id)}" is already used in the document; remove it first to replace it.` });
        return;
      }
      taken.add(item.id);
    });
  }

  if (errors.length > 0) return fail(errors);

  const doc = {
    ...base,
    nodes: [...keptNodes, ...(patch.nodes || [])],
    edges: [...keptEdges, ...(patch.edges || [])],
  };
  if (Array.isArray(base.notes) || (patch.notes || []).length > 0) {
    doc.notes = [...keptNotes, ...(patch.notes || [])];
  }
  if (patch.tour !== undefined) {
    if (patch.tour.length > 0) doc.tour = patch.tour;
    else delete doc.tour;
  }
  // A deep copy, so nothing the caller later does to the result reaches
  // either input.
  return { doc: JSON.parse(JSON.stringify(doc)), errors: [] };
}

module.exports = { applyPatch, PATCH_LIMITS };
