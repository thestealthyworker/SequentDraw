// Input validation: structure, references, and the SPEC enums. Fails loudly
// with a clear Error on any violation (docs/SPEC.md "invariants the
// renderer validates before drawing"). Escaping in render-svg.js is kept as
// defence in depth regardless — this is not the only line of defence
// against a malformed or hostile doc.

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const LAYER_VALUES = new Set(['base', 'edge', 'business', 'build']);
const KIND_VALUES = new Set(['service', 'human', 'external', 'manual', 'artifact', 'logic']);
const STATUS_VALUES = new Set(['open', 'confirmed', 'suggested']);
const EDGE_TYPE_VALUES = new Set(['solid', 'dashed', 'gutter']);
const GROUP_COLOR_VALUES = new Set(['purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber', 'gray']);
const NOTE_COLOR_VALUES = new Set(['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'gray']);
const NOTE_CONTENT_MAX_LENGTH = 2000;
const NOTES_MAX_COUNT = 20;

function checkId(id, what) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`${what} id ${JSON.stringify(id)} must match ${ID_RE} (1-64 chars: letters, digits, _ . : -)`);
  }
}

function checkLayers(layers, what) {
  if (layers == null) return;
  if (!Array.isArray(layers)) throw new Error(`${what}.layers must be an array`);
  for (const l of layers) {
    if (!LAYER_VALUES.has(l)) {
      throw new Error(`${what}.layers contains "${l}", expected one of ${[...LAYER_VALUES].join(', ')}`);
    }
  }
}

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
  const title = typeof doc.title === 'string' ? doc.title : 'SequentDraw map';

  groups.forEach(g => {
    checkId(g && g.id, 'Group');
    if (g.color != null && !GROUP_COLOR_VALUES.has(g.color)) {
      throw new Error(`Group "${g.id}" has color "${g.color}", expected one of ${[...GROUP_COLOR_VALUES].join(', ')}`);
    }
  });

  const groupIds = new Set(groups.map(g => g.id));
  const nodeIds = new Set(doc.nodes.map(n => n.id));

  const dupGroup = groups.map(g => g.id).find((id, i, arr) => arr.indexOf(id) !== i);
  if (dupGroup) throw new Error(`Duplicate group id: "${dupGroup}"`);

  const dupNode = doc.nodes.map(n => n.id).find((id, i, arr) => arr.indexOf(id) !== i);
  if (dupNode) throw new Error(`Duplicate node id: "${dupNode}"`);

  for (const n of doc.nodes) {
    checkId(n && n.id, 'Node');
    if (n.parentId != null && !groupIds.has(n.parentId)) {
      throw new Error(`Node "${n.id}" has parentId "${n.parentId}" which is not a declared group`);
    }
    if (n.kind != null && !KIND_VALUES.has(n.kind)) {
      throw new Error(`Node "${n.id}" has kind "${n.kind}", expected one of ${[...KIND_VALUES].join(', ')}`);
    }
    if (n.status != null && !STATUS_VALUES.has(n.status)) {
      throw new Error(`Node "${n.id}" has status "${n.status}", expected one of ${[...STATUS_VALUES].join(', ')}`);
    }
    checkLayers(n.layers, `Node "${n.id}"`);
  }

  for (const [i, e] of doc.edges.entries()) {
    if (!nodeIds.has(e.from)) {
      throw new Error(`Edge #${i} has "from": "${e.from}" which is not a declared node`);
    }
    if (!nodeIds.has(e.to)) {
      throw new Error(`Edge #${i} has "to": "${e.to}" which is not a declared node`);
    }
    if (e.type != null && !EDGE_TYPE_VALUES.has(e.type)) {
      throw new Error(`Edge #${i} has type "${e.type}", expected one of ${[...EDGE_TYPE_VALUES].join(', ')}`);
    }
  }

  const notes = Array.isArray(doc.notes) ? doc.notes : [];
  if (notes.length > NOTES_MAX_COUNT) {
    throw new Error(`Too many notes: ${notes.length} (max ${NOTES_MAX_COUNT})`);
  }

  const noteIds = new Set();
  for (const note of notes) {
    checkId(note && note.id, 'Note');
    if (nodeIds.has(note.id) || groupIds.has(note.id)) {
      throw new Error(`Note "${note.id}" id collides with a node or group id`);
    }
    if (noteIds.has(note.id)) {
      throw new Error(`Duplicate note id: "${note.id}"`);
    }
    noteIds.add(note.id);

    if (typeof note.content !== 'string' || note.content.trim().length === 0) {
      throw new Error(`Note "${note.id}" content must be a non-empty string`);
    }
    if (note.content.length > NOTE_CONTENT_MAX_LENGTH) {
      throw new Error(`Note "${note.id}" content is ${note.content.length} chars, max ${NOTE_CONTENT_MAX_LENGTH}`);
    }
    if (note.color != null && !NOTE_COLOR_VALUES.has(note.color)) {
      throw new Error(`Note "${note.id}" has color "${note.color}", expected one of ${[...NOTE_COLOR_VALUES].join(', ')}`);
    }
    if (note.attachTo != null) {
      if (!Array.isArray(note.attachTo)) {
        throw new Error(`Note "${note.id}".attachTo must be an array`);
      }
      for (const targetId of note.attachTo) {
        if (!nodeIds.has(targetId) && !groupIds.has(targetId)) {
          throw new Error(`Note "${note.id}".attachTo references "${targetId}" which is not a declared node or group`);
        }
      }
    }
    checkLayers(note.layers, `Note "${note.id}"`);
  }

  return { title, groups, nodes: doc.nodes, edges: doc.edges, notes };
}

module.exports = { validateDoc };
