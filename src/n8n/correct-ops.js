// The correction operations the viewer offers in correction mode
// (docs/design/correction-mode.md, build step 7a). Pure: nothing here
// touches the DOM, the filesystem or its input document.
//
// Three entry points:
//
//   guard(doc, op)      -> null when the operation is allowed, else
//                          { code, message, fix } where `fix` is the
//                          operation list that would make it legal
//   applyOp(doc, op)    -> a NEW document with the operation applied;
//                          throws on anything guard() refuses
//   describeOp(doc, op) -> the change-list line, read against the
//                          document AS IT IS BEFORE the operation
//
// The viewer keeps an operation stack and replays it from the embedded
// source document, so `index` on an edge operation means "index into
// doc.edges as it stands when this operation is applied". Replay is
// deterministic and in order, so those indices stay meaningful; node and
// note operations use ids, which validation already keeps unique.
//
// Written in plain ES5 var/function style, like edge-visibility.js,
// handle-visibility.js and frame-box.js, because render-shell.js inlines
// these functions verbatim into the viewer's single <script> (the browser
// cannot require() this module) and tests/n8n-inlined-functions.test.js
// compares the two copies textually.
//
// The engine stays authoritative: validateDoc() runs on every render, and
// these guards are the subset that can be decided without the integration
// catalogue or a layout pass. They exist so the user learns the reason at
// the moment of the mistake.

var CORRECT_KINDS = ['service', 'human', 'external', 'manual', 'artifact', 'logic'];
var CORRECT_LAYERS = ['base', 'edge', 'business', 'build'];
var CORRECT_NOTE_COLORS = ['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'gray'];
var CORRECT_NOTE_CONTENT_MAX = 2000;
var CORRECT_NOTES_MAX = 20;

function correctNodes(doc) { return doc.nodes || []; }
function correctEdges(doc) { return doc.edges || []; }
function correctNotes(doc) { return doc.notes || []; }
function correctGroups(doc) { return doc.groups || []; }

function correctFind(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// Every lookup keyed by a document id uses a null-prototype object. An id
// is author-controlled and validate.js's ID_RE allows "__proto__" (and
// "constructor", "toString", ...) as a legal id: on a plain {}, reading
// one of those returns something inherited and truthy before anything is
// stored, and assigning to "__proto__" is swallowed instead of creating an
// own key. Both directions corrupt the orphan-rule arithmetic below -- a
// legal deletion refused, or a stranding missed and a document produced
// that validateDoc then rejects. Same defence as render.js and
// render-shell.js.
function correctIdSet(ids) {
  var set = Object.create(null);
  ids.forEach(function(id){ set[id] = true; });
  return set;
}

function correctRefuse(code, message, fix) {
  return { code: code, message: message, fix: fix || null };
}

function correctLabelOf(doc, id) {
  var node = correctFind(correctNodes(doc), id);
  if (node) return node.label;
  var group = correctFind(correctGroups(doc), id);
  return group ? group.label : id;
}

function correctGroupKey(node) {
  return node.parentId == null ? ' ungrouped' : node.parentId;
}

// The orphan rule (docs/SPEC.md, validated by validate.js): a node with no
// edges is legal only when it is the only node in its group, where every
// ungrouped node shares one bucket. Returns the ids that WOULD be stranded
// if `keptEdges` were the document's edges.
function correctStrandedBy(doc, keptEdges, removedNodeIds) {
  var removed = correctIdSet(removedNodeIds || []);
  var incident = Object.create(null);
  keptEdges.forEach(function(e){ incident[e.from] = true; incident[e.to] = true; });
  var bucketSizes = Object.create(null);
  var survivors = correctNodes(doc).filter(function(n){ return !removed[n.id]; });
  survivors.forEach(function(n){
    var key = correctGroupKey(n);
    bucketSizes[key] = (bucketSizes[key] || 0) + 1;
  });
  return survivors
    .filter(function(n){ return !incident[n.id] && bucketSizes[correctGroupKey(n)] > 1; })
    .map(function(n){ return n.id; });
}

function correctEdgesWithout(doc, nodeIds) {
  var gone = correctIdSet(nodeIds);
  return correctEdges(doc).filter(function(e){ return !gone[e.from] && !gone[e.to]; });
}

function correctStrandRefusal(doc, keptEdges, removedNodeIds) {
  var stranded = correctStrandedBy(doc, keptEdges, removedNodeIds);
  if (!stranded.length) return null;
  var names = stranded.map(function(id){ return '"' + correctLabelOf(doc, id) + '"'; }).join(', ');
  var fix = stranded.map(function(id){ return { type: 'delete-node', node: id }; });
  return correctRefuse(
    'would-strand-node',
    'That would leave ' + names + ' with no connections, which the engine rejects. Delete it as well?',
    fix
  );
}

function correctSuggestionsCiting(doc, nodeId) {
  return correctNodes(doc)
    .filter(function(n){ return n.status === 'suggested' && (n.cites || []).indexOf(nodeId) !== -1; })
    .map(function(n){ return n.id; });
}

function correctNextNoteId(doc) {
  var taken = Object.create(null);
  correctNodes(doc).forEach(function(n){ taken[n.id] = true; });
  correctGroups(doc).forEach(function(g){ taken[g.id] = true; });
  correctNotes(doc).forEach(function(n){ taken[n.id] = true; });
  var i = 1;
  while (taken['n_user_' + i]) i++;
  return 'n_user_' + i;
}

var CORRECT_NOTE_FIELDS = ['content', 'color', 'layers', 'attachTo'];

function correctHasField(fields, key) {
  return Object.prototype.hasOwnProperty.call(fields, key);
}

function correctNoteFields(doc, fields) {
  if (correctHasField(fields, 'content')) {
    if (typeof fields.content !== 'string' || !fields.content.trim()) {
      return correctRefuse('empty-note', 'A sticky note needs some text.');
    }
    if (fields.content.length > CORRECT_NOTE_CONTENT_MAX) {
      return correctRefuse('note-too-long', 'A sticky note holds at most ' + CORRECT_NOTE_CONTENT_MAX + ' characters.');
    }
  }
  if (correctHasField(fields, 'color') && CORRECT_NOTE_COLORS.indexOf(fields.color) === -1) {
    return correctRefuse('unknown-color', 'A sticky note is one of: ' + CORRECT_NOTE_COLORS.join(', ') + '.');
  }
  if (correctHasField(fields, 'layers')) {
    var layerRefusal = correctLayerSet(fields.layers);
    if (layerRefusal) return layerRefusal;
  }
  if (correctHasField(fields, 'attachTo')) {
    if (!Array.isArray(fields.attachTo)) {
      return correctRefuse('invalid-attach', 'A sticky note attaches to a list of nodes or groups.');
    }
    for (var i = 0; i < fields.attachTo.length; i++) {
      var id = fields.attachTo[i];
      if (!correctFind(correctNodes(doc), id) && !correctFind(correctGroups(doc), id)) {
        return correctRefuse('unknown-attach-target', 'This map has nothing called "' + id + '" to attach a note to.');
      }
    }
  }
  return null;
}

function correctLayerSet(layers) {
  if (!Array.isArray(layers) || !layers.length) {
    return correctRefuse('no-layers', 'A node has to be on at least one layer.');
  }
  var seen = {};
  for (var i = 0; i < layers.length; i++) {
    if (CORRECT_LAYERS.indexOf(layers[i]) === -1) {
      return correctRefuse('unknown-layer', 'The layers are ' + CORRECT_LAYERS.join(', ') + '.');
    }
    if (seen[layers[i]]) return correctRefuse('duplicate-layer', 'The layer "' + layers[i] + '" is listed twice.');
    seen[layers[i]] = true;
  }
  return null;
}

function correctRequireNode(doc, id) {
  var node = correctFind(correctNodes(doc), id);
  if (!node) return correctRefuse('unknown-node', 'This map has no node called "' + id + '".');
  return null;
}

function correctRequireEdge(doc, index) {
  var edges = correctEdges(doc);
  if (typeof index !== 'number' || index < 0 || index >= edges.length) {
    return correctRefuse('unknown-edge', 'That connection is no longer in the map.');
  }
  return null;
}

// --- guard -------------------------------------------------------------

function guard(doc, op) {
  if (!op || typeof op.type !== 'string') {
    return correctRefuse('unknown-operation', 'That is not a correction this map understands.');
  }
  if (op.type === 'reattach-edge') return guardReattachEdge(doc, op);
  if (op.type === 'delete-edge') return guardDeleteEdge(doc, op);
  if (op.type === 'set-group') return guardSetGroup(doc, op);
  if (op.type === 'set-layers') return guardSetLayers(doc, op);
  if (op.type === 'set-kind') return guardSetKind(doc, op);
  if (op.type === 'add-note') return guardAddNote(doc, op);
  if (op.type === 'edit-note') return guardEditNote(doc, op);
  if (op.type === 'delete-note') return guardDeleteNote(doc, op);
  if (op.type === 'accept-suggestion') return guardAcceptSuggestion(doc, op);
  if (op.type === 'delete-node') return guardDeleteNode(doc, op);
  return correctRefuse('unknown-operation', 'That is not a correction this map understands.');
}

function guardReattachEdge(doc, op) {
  var edgeRefusal = correctRequireEdge(doc, op.index);
  if (edgeRefusal) return edgeRefusal;
  if (op.end !== 'from' && op.end !== 'to') {
    return correctRefuse('unknown-end', 'A connection is reattached at its "from" end or its "to" end.');
  }
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  var edge = correctEdges(doc)[op.index];
  var from = op.end === 'from' ? op.node : edge.from;
  var to = op.end === 'to' ? op.node : edge.to;
  if (from === to) {
    return correctRefuse('self-edge', 'A connection cannot start and end at "' + correctLabelOf(doc, from) + '".');
  }
  var clash = correctEdges(doc).some(function(e, i){ return i !== op.index && e.from === from && e.to === to; });
  if (clash) {
    return correctRefuse(
      'duplicate-edge',
      'This map already connects "' + correctLabelOf(doc, from) + '" to "' + correctLabelOf(doc, to) + '".'
    );
  }
  // Moving an end away can leave the node it left with no edges at all.
  var kept = correctEdges(doc).map(function(e, i){
    return i === op.index ? { from: from, to: to, type: e.type } : e;
  });
  return correctStrandRefusal(doc, kept, []);
}

function guardDeleteEdge(doc, op) {
  var edgeRefusal = correctRequireEdge(doc, op.index);
  if (edgeRefusal) return edgeRefusal;
  var kept = correctEdges(doc).filter(function(e, i){ return i !== op.index; });
  return correctStrandRefusal(doc, kept, []);
}

function guardSetGroup(doc, op) {
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  if (op.group != null && !correctFind(correctGroups(doc), op.group)) {
    return correctRefuse('unknown-group', 'This map has no group called "' + op.group + '".');
  }
  return null;
}

function guardSetLayers(doc, op) {
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  return correctLayerSet(op.layers);
}

function guardSetKind(doc, op) {
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  if (CORRECT_KINDS.indexOf(op.kind) === -1) {
    return correctRefuse('unknown-kind', 'A node is one of: ' + CORRECT_KINDS.join(', ') + '.');
  }
  return null;
}

function guardAddNote(doc, op) {
  if (correctNotes(doc).length >= CORRECT_NOTES_MAX) {
    return correctRefuse('too-many-notes', 'A map holds at most ' + CORRECT_NOTES_MAX + ' sticky notes.');
  }
  // Built key by key: correctNoteFields() now reads presence, not value,
  // so an "attachTo: undefined" written here would be checked as if the
  // caller had asked for an attachment and left it blank.
  var fields = {
    content: op.content,
    color: op.color === undefined ? 'yellow' : op.color,
    layers: op.layers === undefined ? ['base'] : op.layers,
  };
  if (op.attachTo !== undefined) fields.attachTo = op.attachTo;
  return correctNoteFields(doc, fields);
}

function guardEditNote(doc, op) {
  if (!correctFind(correctNotes(doc), op.note)) {
    return correctRefuse('unknown-note', 'That sticky note is no longer in the map.');
  }
  var patch = op.patch || {};
  // Allow-list, the way validate.js rejects an unknown document field. A
  // patch is the one place an operation carries caller-supplied KEYS
  // rather than values, and applyEditNote must never copy a key it has
  // not checked -- "__proto__" among them, which arrives as a real own
  // key from JSON.parse and would reassign the copy's prototype.
  var keys = Object.keys(patch);
  for (var i = 0; i < keys.length; i++) {
    if (CORRECT_NOTE_FIELDS.indexOf(keys[i]) === -1) {
      return correctRefuse('unknown-note-field', 'A sticky note has no field called "' + keys[i] + '".');
    }
  }
  return correctNoteFields(doc, patch);
}

function guardDeleteNote(doc, op) {
  if (!correctFind(correctNotes(doc), op.note)) {
    return correctRefuse('unknown-note', 'That sticky note is no longer in the map.');
  }
  return null;
}

function guardAcceptSuggestion(doc, op) {
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  var node = correctFind(correctNodes(doc), op.node);
  if (node.status !== 'suggested') {
    return correctRefuse('not-suggested', '"' + node.label + '" is part of the map already, not a suggestion.');
  }
  return null;
}

function guardDeleteNode(doc, op) {
  var nodeRefusal = correctRequireNode(doc, op.node);
  if (nodeRefusal) return nodeRefusal;
  var citing = correctSuggestionsCiting(doc, op.node);
  if (citing.length) {
    var names = citing.map(function(id){ return '"' + correctLabelOf(doc, id) + '"'; }).join(', ');
    var fix = citing.map(function(id){ return { type: 'delete-node', node: id }; });
    fix.push({ type: 'delete-node', node: op.node });
    return correctRefuse(
      'cited-by-suggestion',
      'The suggestion ' + names + ' explains itself by pointing at "' + correctLabelOf(doc, op.node)
        + '". Decline the suggestion as well?',
      fix
    );
  }
  return correctStrandRefusal(doc, correctEdgesWithout(doc, [op.node]), [op.node]);
}

// --- applyOp -----------------------------------------------------------

function correctWithNodes(doc, nodes) {
  var next = {};
  Object.keys(doc).forEach(function(k){ next[k] = doc[k]; });
  next.nodes = nodes;
  return next;
}

function correctMapNode(doc, id, change) {
  return correctWithNodes(doc, correctNodes(doc).map(function(n){
    return n.id === id ? change(n) : n;
  }));
}

// A node the user has corrected is marked as theirs, the same mark an
// accepted suggestion gets (docs/SPEC.md "Suggestions"), so a reader of the
// corrected document can tell a scan's claim from a human's fix.
function correctNodeWith(node, fields) {
  var next = {};
  Object.keys(node).forEach(function(k){ next[k] = node[k]; });
  Object.keys(fields).forEach(function(k){
    if (fields[k] === undefined) delete next[k];
    else next[k] = fields[k];
  });
  next.source = 'user';
  return next;
}

function applyOp(doc, op) {
  var refusal = guard(doc, op);
  if (refusal) throw new Error(refusal.code + ': ' + refusal.message);
  if (op.type === 'reattach-edge') return applyReattachEdge(doc, op);
  if (op.type === 'delete-edge') return applyDeleteEdge(doc, op);
  if (op.type === 'set-group') return correctMapNode(doc, op.node, function(n){ return correctNodeWith(n, { parentId: op.group }); });
  if (op.type === 'set-layers') return correctMapNode(doc, op.node, function(n){ return correctNodeWith(n, { layers: op.layers.slice() }); });
  if (op.type === 'set-kind') return applySetKind(doc, op);
  if (op.type === 'add-note') return applyAddNote(doc, op);
  if (op.type === 'edit-note') return applyEditNote(doc, op);
  if (op.type === 'delete-note') return applyDeleteNote(doc, op);
  if (op.type === 'accept-suggestion') return applyAcceptSuggestion(doc, op);
  return applyDeleteNode(doc, op);
}

function correctWith(doc, fields) {
  var next = {};
  Object.keys(doc).forEach(function(k){ next[k] = doc[k]; });
  Object.keys(fields).forEach(function(k){ next[k] = fields[k]; });
  return next;
}

function applyReattachEdge(doc, op) {
  return correctWith(doc, {
    edges: correctEdges(doc).map(function(e, i){
      if (i !== op.index) return e;
      var next = {};
      Object.keys(e).forEach(function(k){ next[k] = e[k]; });
      next[op.end] = op.node;
      return next;
    }),
  });
}

function applyDeleteEdge(doc, op) {
  return correctWith(doc, { edges: correctEdges(doc).filter(function(e, i){ return i !== op.index; }) });
}

// A brand icon belongs to a service. Once the node is a person, an outside
// party, a hand-done step, a document or a decision, the mark is wrong --
// a person wearing the Stripe logo is exactly the sort of thing correction
// mode exists to undo.
function applySetKind(doc, op) {
  return correctMapNode(doc, op.node, function(n){
    var fields = { kind: op.kind };
    if (op.kind !== 'service' && n.icon) fields.icon = null;
    return correctNodeWith(n, fields);
  });
}

function applyAddNote(doc, op) {
  var note = {
    id: correctNextNoteId(doc),
    content: op.content,
    color: op.color === undefined ? 'yellow' : op.color,
    layers: (op.layers === undefined ? ['base'] : op.layers).slice(),
  };
  if (op.attachTo) note.attachTo = op.attachTo.slice();
  return correctWith(doc, { notes: correctNotes(doc).concat([note]) });
}

function applyEditNote(doc, op) {
  var patch = op.patch || {};
  return correctWith(doc, {
    notes: correctNotes(doc).map(function(note){
      if (note.id !== op.note) return note;
      var next = {};
      Object.keys(note).forEach(function(k){ next[k] = note[k]; });
      // Named fields only, never a copy of the patch's own keys: the guard
      // has checked exactly these four.
      CORRECT_NOTE_FIELDS.forEach(function(k){
        if (correctHasField(patch, k)) next[k] = patch[k];
      });
      return next;
    }),
  });
}

function applyDeleteNote(doc, op) {
  return correctWith(doc, { notes: correctNotes(doc).filter(function(note){ return note.id !== op.note; }) });
}

function applyAcceptSuggestion(doc, op) {
  return correctMapNode(doc, op.node, function(n){
    return correctNodeWith(n, { status: undefined, rationale: undefined, cites: undefined });
  });
}

// Removing a node takes its edges with it, and prunes it out of every note
// that names it -- a note left pointing at a node that is gone would fail
// validation, and one that names nothing but the deleted node has lost its
// subject, so it goes too.
function applyDeleteNode(doc, op) {
  var notes = [];
  correctNotes(doc).forEach(function(note){
    if (!note.attachTo) { notes.push(note); return; }
    var kept = note.attachTo.filter(function(id){ return id !== op.node; });
    if (!kept.length) return;
    if (kept.length === note.attachTo.length) { notes.push(note); return; }
    var next = {};
    Object.keys(note).forEach(function(k){ next[k] = note[k]; });
    next.attachTo = kept;
    notes.push(next);
  });
  return correctWith(doc, {
    nodes: correctNodes(doc).filter(function(n){ return n.id !== op.node; }),
    edges: correctEdgesWithout(doc, [op.node]),
    notes: notes,
  });
}

// --- describeOp --------------------------------------------------------

function correctNoteSubject(doc, attachTo) {
  if (!attachTo || !attachTo.length) return 'the map';
  return attachTo.map(function(id){ return '*' + correctLabelOf(doc, id) + '*'; }).join(' and ');
}

function describeOp(doc, op) {
  if (op.type === 'set-group') return describeSetGroup(doc, op);
  if (op.type === 'reattach-edge') return describeReattachEdge(doc, op);
  if (op.type === 'delete-edge') return describeDeleteEdge(doc, op);
  if (op.type === 'set-layers') return describeSetLayers(doc, op);
  if (op.type === 'set-kind') return describeSetKind(doc, op);
  if (op.type === 'accept-suggestion') return describeAcceptSuggestion(doc, op);
  if (op.type === 'delete-node') return describeDeleteNode(doc, op);
  if (op.type === 'add-note') return 'Added a sticky note on ' + correctNoteSubject(doc, op.attachTo) + '.';
  if (op.type === 'edit-note' || op.type === 'delete-note') return describeNoteChange(doc, op);
  return 'Made a correction this map cannot describe.';
}

function describeSetGroup(doc, op) {
  var node = correctFind(correctNodes(doc), op.node);
  var was = node.parentId == null ? null : correctLabelOf(doc, node.parentId);
  if (op.group == null) {
    return was
      ? 'Moved **' + node.label + '** out of *' + was + '*.'
      : 'Left **' + node.label + '** outside every group.';
  }
  var now = correctLabelOf(doc, op.group);
  return was
    ? 'Moved **' + node.label + '** from *' + was + '* to *' + now + '*.'
    : 'Moved **' + node.label + '** into *' + now + '*.';
}

function describeReattachEdge(doc, op) {
  var edge = correctEdges(doc)[op.index];
  var anchor = op.end === 'to' ? edge.from : edge.to;
  var wasId = op.end === 'to' ? edge.to : edge.from;
  var direction = op.end === 'to' ? 'to' : 'from';
  return 'Reattached the connection ' + (op.end === 'to' ? 'from' : 'to') + ' **' + correctLabelOf(doc, anchor)
    + '**: now ' + direction + ' *' + correctLabelOf(doc, op.node) + '* (was *' + correctLabelOf(doc, wasId) + '*).';
}

function describeDeleteEdge(doc, op) {
  var edge = correctEdges(doc)[op.index];
  var condition = edge.condition ? ' ("' + edge.condition + '")' : '';
  return 'Deleted the connection *' + correctLabelOf(doc, edge.from) + '* to *' + correctLabelOf(doc, edge.to) + '*' + condition + '.';
}

function describeSetLayers(doc, op) {
  var node = correctFind(correctNodes(doc), op.node);
  var was = (node.layers && node.layers.length ? node.layers : ['base']).join(', ');
  return 'Changed **' + node.label + '** layers from ' + was + ' to ' + op.layers.join(', ') + '.';
}

function describeSetKind(doc, op) {
  var node = correctFind(correctNodes(doc), op.node);
  var cleared = op.kind !== 'service' && node.icon ? ', and cleared its icon `' + node.icon + '`' : '';
  return 'Changed **' + node.label + '** from `' + node.kind + '` to `' + op.kind + '`' + cleared + '.';
}

function describeAcceptSuggestion(doc, op) {
  var node = correctFind(correctNodes(doc), op.node);
  return 'Accepted the suggested integration **' + node.label + '** (`' + node.integration + '`).';
}

function describeDeleteNode(doc, op) {
  var node = correctFind(correctNodes(doc), op.node);
  if (node.status === 'suggested') {
    return 'Declined the suggested integration **' + node.label + '** (`' + node.integration + '`).';
  }
  return 'Deleted **' + node.label + '** and its connections.';
}

function describeNoteChange(doc, op) {
  var note = correctFind(correctNotes(doc), op.note);
  var subject = correctNoteSubject(doc, note ? note.attachTo : null);
  return (op.type === 'delete-note' ? 'Deleted' : 'Edited') + ' a sticky note on ' + subject + '.';
}

// The viewer needs this whole module, and the browser cannot require() it.
// Rather than keeping a second, hand-copied text of every function -- the
// convention edge-visibility.js and frame-box.js use, which works for a
// one-line body and would be 500 lines of duplication here --
// render-correct.js emits each function's own `toString()` and each
// constant as JSON. The viewer therefore runs THIS source, not a copy of
// it, so there is no drift to test for: at worst the emitting is wrong,
// and tests/n8n-correction-viewer.test.js checks the emitted text holds
// every name below.
var VIEWER_CONSTANTS = {
  CORRECT_KINDS: CORRECT_KINDS,
  CORRECT_LAYERS: CORRECT_LAYERS,
  CORRECT_NOTE_COLORS: CORRECT_NOTE_COLORS,
  CORRECT_NOTE_CONTENT_MAX: CORRECT_NOTE_CONTENT_MAX,
  CORRECT_NOTES_MAX: CORRECT_NOTES_MAX,
  CORRECT_NOTE_FIELDS: CORRECT_NOTE_FIELDS,
};

var VIEWER_FUNCTIONS = [
  correctNodes,
  correctEdges,
  correctNotes,
  correctGroups,
  correctFind,
  correctIdSet,
  correctRefuse,
  correctLabelOf,
  correctGroupKey,
  correctStrandedBy,
  correctEdgesWithout,
  correctStrandRefusal,
  correctSuggestionsCiting,
  correctNextNoteId,
  correctHasField,
  correctNoteFields,
  correctLayerSet,
  correctRequireNode,
  correctRequireEdge,
  guard,
  guardReattachEdge,
  guardDeleteEdge,
  guardSetGroup,
  guardSetLayers,
  guardSetKind,
  guardAddNote,
  guardEditNote,
  guardDeleteNote,
  guardAcceptSuggestion,
  guardDeleteNode,
  correctWithNodes,
  correctMapNode,
  correctNodeWith,
  applyOp,
  correctWith,
  applyReattachEdge,
  applyDeleteEdge,
  applySetKind,
  applyAddNote,
  applyEditNote,
  applyDeleteNote,
  applyAcceptSuggestion,
  applyDeleteNode,
  correctNoteSubject,
  describeOp,
  describeSetGroup,
  describeReattachEdge,
  describeDeleteEdge,
  describeSetLayers,
  describeSetKind,
  describeAcceptSuggestion,
  describeDeleteNode,
  describeNoteChange,
];

module.exports = {
  guard: guard,
  applyOp: applyOp,
  describeOp: describeOp,
  VIEWER_CONSTANTS: VIEWER_CONSTANTS,
  VIEWER_FUNCTIONS: VIEWER_FUNCTIONS,
};
