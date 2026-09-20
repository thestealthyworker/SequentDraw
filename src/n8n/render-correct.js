// Correction mode: the CSS, the markup and the viewer wiring
// (docs/design/correction-mode.md, build step 7a).
//
// The reader fixes what the map SAYS, never where it sits. Nothing here
// writes a coordinate and there is no dragging: position is computed by
// the engine at render time (docs/SPEC.md, "Positions are never stored"),
// so a corrected document is saved and re-rendered rather than nudged.
//
// Split out of render-shell.js to keep both files inside this repo's file
// budget. The decisions themselves -- what an operation changes, what
// refuses it, how it reads in the change list -- live in correct-ops.js
// and are emitted into the viewer verbatim by correctOpsSource() below.

const { VIEWER_CONSTANTS, VIEWER_FUNCTIONS } = require('./correct-ops');

// The operations module, as the browser will run it. Each function is its
// own source text via toString(), so the viewer cannot drift from the
// Node module the tests exercise; the constants are emitted as JSON.
function correctOpsSource() {
  const constants = Object.keys(VIEWER_CONSTANTS)
    .map(name => `var ${name} = ${JSON.stringify(VIEWER_CONSTANTS[name])};`)
    .join('\n');
  const functions = VIEWER_FUNCTIONS.map(fn => fn.toString()).join('\n\n');
  return `${constants}\n\n${functions}`;
}

function correctBarMarkup() {
  return `<div class="correct-bar">
<button id="correct-toggle" type="button" aria-pressed="false" title="Correct this map">Correct<span id="correct-count" class="correct-count" hidden></span></button>
</div>
<aside id="correct-panel" class="correct-panel" aria-label="Corrections" hidden></aside>`;
}

function correctCss() {
  return `
.correct-bar{position:fixed;left:16px;bottom:20px;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:999px;padding:6px;display:flex;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.correct-bar button{border:none;background:transparent;border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;color:#444;cursor:pointer;display:flex;align-items:center;gap:8px}
.correct-bar button:hover{background:rgba(0,0,0,.06)}
.correct-bar button[aria-pressed="true"]{background:#7c5cc4;color:#fff}
.correct-count{background:rgba(0,0,0,.12);border-radius:999px;padding:1px 7px;font-size:11px}
.correct-bar button[aria-pressed="true"] .correct-count{background:rgba(255,255,255,.25)}

.correct-panel{position:fixed;right:16px;bottom:20px;top:auto;width:min(340px,80vw);max-height:60vh;overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:14px;font-size:13px;line-height:1.5;color:#333;z-index:900}
.correct-panel[hidden]{display:none}
.correct-panel h2{margin:0 0 8px;font-size:13px;font-weight:700}
.correct-panel ol{margin:0;padding-left:18px}
.correct-panel li{margin-bottom:6px}
.correct-empty{color:#888;margin:0 0 10px}
.correct-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.correct-actions button{font:inherit;font-size:12px;padding:6px 10px;border-radius:8px;border:1px solid rgba(0,0,0,.12);background:#fff;cursor:pointer;color:#333}
.correct-actions button:hover{background:#f4f4f2}
.correct-actions button.is-primary{background:#7c5cc4;border-color:#7c5cc4;color:#fff}
.correct-next{margin:10px 0 0;padding:8px;background:#f6f5f2;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all}

.card-edit{margin-top:12px;border-top:1px solid rgba(0,0,0,.08);padding-top:10px}
.card-edit label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#888;margin:8px 0 3px}
.card-edit select,.card-edit textarea,.card-edit input[type="text"]{width:100%;font:inherit;font-size:12px;padding:5px 6px;border:1px solid rgba(0,0,0,.15);border-radius:6px;background:#fff;color:#333}
.card-edit textarea{min-height:64px;resize:vertical}
.card-edit .card-edit-layers{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.card-edit .card-edit-layers span{display:flex;align-items:center;gap:4px;font-size:12px;color:#555;text-transform:none;letter-spacing:0;font-weight:400}
.card-edit-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.card-edit-buttons button{font:inherit;font-size:12px;padding:5px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.12);background:#fff;cursor:pointer;color:#333}
.card-edit-buttons button:hover{background:#f4f4f2}
.card-edit-buttons button.is-danger{color:#a8332a;border-color:rgba(168,51,42,.35)}
.correct-now{margin:0 0 6px;font-size:12px;color:#555}
.correct-gone{margin:0;font-size:12px;color:#8a8a85;font-style:italic}
.correct-refusal{margin-top:10px;padding:8px;border-radius:8px;background:#fdf2f0;border:1px solid rgba(168,51,42,.25);color:#7a2620}
.correct-refusal button{margin-top:6px;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid rgba(168,51,42,.35);background:#fff;color:#a8332a;cursor:pointer}

body.is-correcting .n8n-note{cursor:pointer}
.is-corrected .node-shape,.is-corrected .grect{stroke:#7c5cc4;stroke-width:3px;stroke-dasharray:none}
.is-corrected .edge-line{stroke:#7c5cc4;stroke-width:2.5px}
.is-corrected rect{stroke:#7c5cc4;stroke-width:2.5px}
`;
}

// The wiring the browser owns: menus built from the embedded document, the
// operation stack, the badges, the panel and the downloads. Everything it
// decides, it asks correct-ops.js.
function correctScript() {
  return `
  // --- Correction mode -------------------------------------------------
  //
  // SOURCE_DOC is the validated document this map was rendered from. The
  // stack below is replayed from it on every change, so undo can never
  // drift from what a save would write.
  var correctStack = [];
  var correctPanel = document.getElementById('correct-panel');
  var correctToggle = document.getElementById('correct-toggle');
  var correctCountEl = document.getElementById('correct-count');
  var correcting = false;
  var correctSelectedNote = null;
  // Where each edge of the source document sits now, or -1 once a
  // correction has removed it. The SVG carries an edge's ORIGINAL index
  // and never changes, so an operation built straight from the DOM would
  // address a different edge after any deletion.
  var correctEdgeTrack = correctEdges(SOURCE_DOC).map(function(_, i){ return i; });

  function correctDoc(){
    return correctStack.reduce(function(doc, op){ return applyOp(doc, op); }, SOURCE_DOC);
  }

  function correctRebuildTrack(){
    var track = correctEdges(SOURCE_DOC).map(function(_, i){ return i; });
    var doc = SOURCE_DOC;
    correctStack.forEach(function(op){
      track = trackEdges(doc, op, track);
      doc = applyOp(doc, op);
    });
    correctEdgeTrack = track;
  }

  // The index an operation on this rendered edge must carry today, or -1
  // when the edge is no longer in the corrected document.
  function correctLiveEdgeIndex(renderedIndex){
    if (typeof renderedIndex !== 'number' || renderedIndex < 0) return -1;
    if (renderedIndex >= correctEdgeTrack.length) return -1;
    return correctEdgeTrack[renderedIndex];
  }

  function correctChangeLines(){
    var doc = SOURCE_DOC;
    return correctStack.map(function(op){
      var line = describeOp(doc, op);
      doc = applyOp(doc, op);
      return line;
    });
  }

  function correctTouchedIds(){
    var ids = Object.create(null);
    var doc = SOURCE_DOC;
    correctStack.forEach(function(op){
      if (op.node) ids['node:' + op.node] = true;
      if (op.note) ids['note:' + op.note] = true;
      if (typeof op.index === 'number' && op.index >= 0 && correctEdges(doc)[op.index]) {
        var e = correctEdges(doc)[op.index];
        ids['edge:' + e.from + '->' + e.to] = true;
      }
      (op.attachTo || []).forEach(function(id){ ids['node:' + id] = true; });
      doc = applyOp(doc, op);
    });
    return ids;
  }

  function correctMarkBadges(){
    var touched = correctTouchedIds();
    nodes.forEach(function(el){ el.classList.toggle('is-corrected', !!touched['node:' + el.dataset.id]); });
    edges.forEach(function(el){
      el.classList.toggle('is-corrected', !!touched['edge:' + el.dataset.from + '->' + el.dataset.to]);
    });
    notes.forEach(function(el){ el.classList.toggle('is-corrected', !!touched['note:' + el.dataset.id]); });
  }

  function correctSlug(title){
    var slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (slug || 'map').slice(0, 60);
  }

  function correctChangeMarkdown(){
    var lines = correctChangeLines();
    var head = '# Corrections to "' + (SOURCE_DOC.title || 'this map') + '"\\n\\n'
      + 'Made in the viewer, ' + lines.length + ' correction' + (lines.length === 1 ? '' : 's') + '.\\n\\n';
    return head + lines.map(function(l){ return '- ' + l; }).join('\\n') + '\\n';
  }

  function correctDownload(name, text, mime){
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
  }

  function correctCopy(text, button){
    var done = function(){
      var was = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function(){ button.textContent = was; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function(){});
      return;
    }
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (err) {}
    document.body.removeChild(area);
  }

  function correctButton(label, className, onClick){
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
  }

  function correctRenderPanel(){
    while (correctPanel.firstChild) correctPanel.removeChild(correctPanel.firstChild);
    var h = document.createElement('h2');
    h.textContent = 'Corrections';
    correctPanel.appendChild(h);

    var lines = correctChangeLines();
    if (!lines.length) {
      var empty = document.createElement('p');
      empty.className = 'correct-empty';
      empty.textContent = 'Open a node, a connection or a sticky note to correct what it says. Nothing moves until the map is re-rendered.';
      correctPanel.appendChild(empty);
    } else {
      var ol = document.createElement('ol');
      lines.forEach(function(line){
        var li = document.createElement('li');
        li.textContent = line;
        ol.appendChild(li);
      });
      correctPanel.appendChild(ol);
    }

    var actions = document.createElement('div');
    actions.className = 'correct-actions';
    var name = correctSlug(SOURCE_DOC.title);
    if (lines.length) {
      actions.appendChild(correctButton(FRAGMENT_MODE ? 'Copy corrected JSON' : 'Save corrected JSON', 'is-primary', function(e){
        var json = JSON.stringify(correctDoc(), null, 2);
        if (FRAGMENT_MODE) { correctCopy(json, e.currentTarget); return; }
        correctDownload(name + '-corrected.json', json, 'application/json');
        correctDownload(name + '-changes.md', correctChangeMarkdown(), 'text/markdown');
      }));
      actions.appendChild(correctButton(FRAGMENT_MODE ? 'Copy change list' : 'Copy corrected JSON', '', function(e){
        correctCopy(FRAGMENT_MODE ? correctChangeMarkdown() : JSON.stringify(correctDoc(), null, 2), e.currentTarget);
      }));
      actions.appendChild(correctButton('Undo', '', function(){
        correctStack.pop();
        correctAfterChange();
      }));
      actions.appendChild(correctButton('Reset all', '', function(){
        correctStack = [];
        correctAfterChange();
      }));
    }
    correctPanel.appendChild(actions);

    // An editor open on a sticky note stays open when an unrelated
    // correction rebuilds the panel; it closes only when the note goes or
    // the reader closes it.
    if (correctSelectedNote) correctAppendNoteEditor(correctSelectedNote);

    if (lines.length) {
      var next = document.createElement('p');
      next.className = 'correct-next';
      next.textContent = FRAGMENT_MODE
        ? 'Paste the corrected JSON back into the conversation and ask for the map again.'
        : 'sequentdraw render ' + name + '-corrected.json ' + name + '-2.html';
      correctPanel.appendChild(next);
    }
  }

  function correctAfterChange(){
    correctRebuildTrack();
    correctMarkBadges();
    correctRenderPanel();
    correctCountEl.hidden = correctStack.length === 0;
    correctCountEl.textContent = String(correctStack.length);
    if (pinnedEl) buildCard(pinnedEl);
  }

  // Every correction goes through here: the guard decides, and a refusal
  // is shown with the operations that would make it legal rather than
  // applied anyway.
  function correctRun(op, host){
    var refusal = guard(correctDoc(), op);
    if (!refusal) {
      correctStack.push(op);
      correctAfterChange();
      return;
    }
    // A refused operation changed nothing, but the control that triggered
    // it is already showing the rejected choice. Rebuilding the editor
    // puts every control back to what the document actually says, and the
    // refusal is then shown on that fresh copy.
    if (pinnedEl && host && host.parentNode === card) {
      buildCard(pinnedEl);
      host = card.querySelector('.card-edit') || card;
    }
    correctShowRefusal(refusal, host);
  }

  function correctShowRefusal(refusal, host){
    // One refusal at a time: retrying a reattach that keeps colliding
    // should replace the message, not stack another copy under it.
    var previous = host.querySelector ? host.querySelector('.correct-refusal') : null;
    if (previous) previous.parentNode.removeChild(previous);
    var box = document.createElement('div');
    box.className = 'correct-refusal';
    var p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = refusal.message;
    box.appendChild(p);
    if (refusal.fix && refusal.fix.length) {
      box.appendChild(correctButton('Do that', '', function(){
        var doc = correctDoc();
        for (var i = 0; i < refusal.fix.length; i++) {
          if (guard(doc, refusal.fix[i])) return;
          doc = applyOp(doc, refusal.fix[i]);
        }
        refusal.fix.forEach(function(fixOp){ correctStack.push(fixOp); });
        correctAfterChange();
      }));
    }
    host.appendChild(box);
  }

  function correctSelect(label, values, current, onChange){
    var wrap = document.createElement('div');
    var l = document.createElement('label');
    l.textContent = label;
    wrap.appendChild(l);
    var select = document.createElement('select');
    values.forEach(function(v){
      var option = document.createElement('option');
      option.value = v.value === null ? '' : v.value;
      option.textContent = v.label;
      if (v.value === current) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function(){
      onChange(select.value === '' ? null : select.value, wrap);
    });
    wrap.appendChild(select);
    return wrap;
  }

  function correctNodeOptions(doc, excludeId){
    return correctNodes(doc)
      .filter(function(n){ return n.id !== excludeId; })
      .map(function(n){ return { value: n.id, label: n.label }; });
  }

  function correctAppendNodeEditor(host, nodeId){
    var doc = correctDoc();
    var node = correctFind(correctNodes(doc), nodeId);
    if (!node) return;
    var box = document.createElement('div');
    box.className = 'card-edit';

    box.appendChild(correctSelect('Kind', CORRECT_KINDS.map(function(k){ return { value: k, label: k }; }), node.kind, function(kind){
      correctRun({ type: 'set-kind', node: nodeId, kind: kind }, box);
    }));

    var groupOptions = [{ value: null, label: 'No group' }].concat(correctGroups(doc).map(function(g){
      return { value: g.id, label: g.label };
    }));
    box.appendChild(correctSelect('Group', groupOptions, node.parentId == null ? null : node.parentId, function(group){
      correctRun({ type: 'set-group', node: nodeId, group: group }, box);
    }));

    var layersLabel = document.createElement('label');
    layersLabel.textContent = 'Layers';
    box.appendChild(layersLabel);
    var layerRow = document.createElement('div');
    layerRow.className = 'card-edit-layers';
    var current = (node.layers && node.layers.length ? node.layers : ['base']).slice();
    CORRECT_LAYERS.forEach(function(layer){
      var span = document.createElement('span');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = current.indexOf(layer) !== -1;
      input.addEventListener('change', function(){
        var next = CORRECT_LAYERS.filter(function(l){
          if (l === layer) return input.checked;
          return current.indexOf(l) !== -1;
        });
        correctRun({ type: 'set-layers', node: nodeId, layers: next }, box);
      });
      var text = document.createElement('span');
      text.textContent = layer;
      span.appendChild(input);
      span.appendChild(text);
      layerRow.appendChild(span);
    });
    box.appendChild(layerRow);

    var buttons = document.createElement('div');
    buttons.className = 'card-edit-buttons';
    if (node.status === 'suggested') {
      buttons.appendChild(correctButton('Accept', '', function(){
        correctRun({ type: 'accept-suggestion', node: nodeId }, box);
      }));
      buttons.appendChild(correctButton('Decline', 'is-danger', function(){
        correctRun({ type: 'delete-node', node: nodeId }, box);
      }));
    } else {
      buttons.appendChild(correctButton('Delete node', 'is-danger', function(){
        correctRun({ type: 'delete-node', node: nodeId }, box);
      }));
    }
    buttons.appendChild(correctButton('Add note here', '', function(){
      correctAppendNoteComposer(box, [nodeId]);
    }));
    box.appendChild(buttons);
    host.appendChild(box);
  }

  function correctAppendEdgeEditor(host, renderedIndex){
    var box = document.createElement('div');
    box.className = 'card-edit';
    var liveIndex = correctLiveEdgeIndex(renderedIndex);
    var doc = correctDoc();
    var edge = liveIndex < 0 ? null : correctEdges(doc)[liveIndex];
    if (!edge) {
      var gone = document.createElement('p');
      gone.className = 'correct-gone';
      gone.textContent = 'This connection is no longer in the corrected map.';
      box.appendChild(gone);
      host.appendChild(box);
      return;
    }

    // The canvas still shows the connection as it was rendered, so where a
    // correction has already moved an end, the card says what it is now.
    var now = document.createElement('p');
    now.className = 'correct-now';
    now.textContent = correctLabelOf(doc, edge.from) + ' \u2192 ' + correctLabelOf(doc, edge.to);
    box.appendChild(now);

    box.appendChild(correctSelect('From', correctNodeOptions(doc, edge.to), edge.from, function(id){
      correctRun({ type: 'reattach-edge', index: correctLiveEdgeIndex(renderedIndex), end: 'from', node: id }, box);
    }));
    box.appendChild(correctSelect('To', correctNodeOptions(doc, edge.from), edge.to, function(id){
      correctRun({ type: 'reattach-edge', index: correctLiveEdgeIndex(renderedIndex), end: 'to', node: id }, box);
    }));

    var buttons = document.createElement('div');
    buttons.className = 'card-edit-buttons';
    buttons.appendChild(correctButton('Delete connection', 'is-danger', function(){
      correctRun({ type: 'delete-edge', index: correctLiveEdgeIndex(renderedIndex) }, box);
    }));
    box.appendChild(buttons);
    host.appendChild(box);
  }

  function correctAppendNoteComposer(host, attachTo){
    var box = document.createElement('div');
    box.className = 'card-edit';
    var label = document.createElement('label');
    label.textContent = 'New sticky note';
    box.appendChild(label);
    var area = document.createElement('textarea');
    box.appendChild(area);
    var color = 'yellow';
    box.appendChild(correctSelect('Colour', CORRECT_NOTE_COLORS.map(function(c){ return { value: c, label: c }; }), color, function(value){
      color = value;
    }));
    var buttons = document.createElement('div');
    buttons.className = 'card-edit-buttons';
    buttons.appendChild(correctButton('Add note', '', function(){
      correctRun({ type: 'add-note', content: area.value, color: color, layers: ['base'], attachTo: attachTo }, box);
    }));
    box.appendChild(buttons);
    host.appendChild(box);
  }

  function correctOpenNoteEditor(noteId){
    correctSelectedNote = noteId;
    correctRenderPanel();
  }

  function correctAppendNoteEditor(noteId){
    var doc = correctDoc();
    var note = correctFind(correctNotes(doc), noteId);
    if (!note) { correctSelectedNote = null; return; }
    var box = document.createElement('div');
    box.className = 'card-edit';
    var label = document.createElement('label');
    label.textContent = 'Sticky note';
    box.appendChild(label);
    var area = document.createElement('textarea');
    area.value = note.content;
    box.appendChild(area);
    box.appendChild(correctSelect('Colour', CORRECT_NOTE_COLORS.map(function(c){ return { value: c, label: c }; }), note.color || 'yellow', function(value){
      correctRun({ type: 'edit-note', note: noteId, patch: { color: value } }, box);
    }));
    var buttons = document.createElement('div');
    buttons.className = 'card-edit-buttons';
    buttons.appendChild(correctButton('Save text', '', function(){
      correctRun({ type: 'edit-note', note: noteId, patch: { content: area.value } }, box);
    }));
    buttons.appendChild(correctButton('Delete note', 'is-danger', function(){
      correctSelectedNote = null;
      correctRun({ type: 'delete-note', note: noteId }, box);
    }));
    buttons.appendChild(correctButton('Close', '', function(){
      correctSelectedNote = null;
      correctRenderPanel();
    }));
    box.appendChild(buttons);
    correctPanel.appendChild(box);
  }

  function correctSetMode(on){
    correcting = on;
    document.body.classList.toggle('is-correcting', on);
    correctToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    correctPanel.hidden = !on;
    if (on) correctRenderPanel();
    if (pinnedEl) buildCard(pinnedEl);
  }

  correctToggle.addEventListener('click', function(){ correctSetMode(!correcting); });

  notes.forEach(function(noteEl){
    noteEl.addEventListener('click', function(){
      if (!correcting) return;
      correctOpenNoteEditor(noteEl.dataset.id);
    });
  });

  // A page with unsaved corrections holds the only copy of them.
  window.addEventListener('beforeunload', function(e){
    if (!correctStack.length) return;
    e.preventDefault();
    e.returnValue = '';
  });
`;
}

module.exports = { correctOpsSource, correctCss, correctScript, correctBarMarkup };
