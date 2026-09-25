// Tours in the viewer (build step 8; docs/SPEC.md "Tours").
//
// A static map answers "what is this". A tour answers "how does this work":
// an ordered list of steps, each spotlighting some nodes with a short
// narration, while everything else is dimmed. Same graph, no extra authoring
// model -- the steps are the document's own `tour` array.
//
// What a tour never does, because the whole product rests on it: it never
// moves a node. The camera moves to frame each step, and visibility changes,
// but every coordinate is the one layout computed. A step whose nodes sit on
// a layer the reader has switched off turns that layer ON for the tour, and
// leaving the tour puts every layer back exactly as the reader had it.
//
// The steps are read from SOURCE_DOC, which the viewer already embeds for
// correction mode, so a tour costs no second copy of the document. Every
// piece of tour text reaches the page through textContent only: a title or
// narration is author-controlled and is never parsed as markup.

// How far the camera may zoom in to frame a step. A step spotlighting one
// node would otherwise fill the screen with it.
const TOUR_MAX_SCALE = 1.25;
// Room around a step's nodes when the camera frames them, in screen px.
const TOUR_FRAME_PAD = 96;

function tourSteps(doc) {
  const tour = doc && Array.isArray(doc.tour) ? doc.tour : [];
  return [...tour].sort((a, b) => a.order - b.order);
}

// The start button sits beside the map's title, since a tour is the map's
// own story. Rendered only when the document has one.
function tourButtonMarkup(doc) {
  const steps = tourSteps(doc);
  if (!steps.length) return '';
  const label = steps.length === 1 ? '1 step' : `${steps.length} steps`;
  return `<button id="tour-start" class="tour-start" type="button" title="Walk through this map, step by step">Take the tour <span class="tour-start-count">${label}</span></button>`;
}

function tourPanelMarkup(doc) {
  if (!tourSteps(doc).length) return '';
  return `<div id="tour-panel" class="tour-panel" role="dialog" aria-label="Map tour" hidden>
<div class="tour-head"><span id="tour-progress" class="tour-progress"></span><button id="tour-exit" class="tour-exit" type="button" aria-label="Leave the tour">&#215;</button></div>
<h2 id="tour-title" class="tour-title"></h2>
<p id="tour-text" class="tour-text" aria-live="polite"></p>
<div class="tour-nav"><button id="tour-prev" type="button">Back</button><button id="tour-next" type="button">Next</button></div>
</div>`;
}

function tourCss() {
  return `
.tour-start{position:fixed;left:16px;top:64px;border:1px solid rgba(124,92,196,.35);background:#ffffff;color:#5b3fa8;border-radius:999px;padding:7px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.tour-start:hover{background:#f6f2ff}
.tour-start:focus-visible{outline:2px solid #7c5cc4;outline-offset:2px}
.tour-start-count{font-weight:500;color:#8a78b8;margin-left:4px}
body.is-touring .tour-start{display:none}
.tour-panel{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);width:min(440px,calc(100vw - 32px));background:#ffffff;border:1px solid rgba(0,0,0,.1);border-radius:14px;padding:14px 16px 12px;box-shadow:0 12px 32px rgba(0,0,0,.16);z-index:900}
.tour-panel[hidden]{display:none}
.tour-head{display:flex;align-items:center;justify-content:space-between}
.tour-progress{font-size:12px;font-weight:600;color:#7c5cc4;letter-spacing:.02em}
.tour-exit{border:none;background:transparent;font-size:20px;line-height:1;color:#888;cursor:pointer;padding:0 4px;border-radius:6px}
.tour-exit:hover{color:#333;background:rgba(0,0,0,.05)}
.tour-title{margin:6px 0 4px;font-size:16px;font-weight:600;color:#222}
.tour-text{margin:0;font-size:14px;line-height:1.5;color:#444;white-space:pre-wrap}
.tour-nav{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.tour-nav button{border:1px solid rgba(0,0,0,.12);background:#fff;border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;color:#333;cursor:pointer}
.tour-nav button:hover{background:rgba(0,0,0,.04)}
.tour-nav button:disabled{opacity:.4;cursor:default}
.tour-nav button:focus-visible,.tour-exit:focus-visible{outline:2px solid #7c5cc4;outline-offset:2px}
#tour-next{background:#7c5cc4;border-color:#7c5cc4;color:#fff}
#tour-next:hover{background:#6c4cb4}
.n8n-node.tour-dim,.n8n-edge.tour-dim,.n8n-note.tour-dim,.n8n-frame.tour-dim{opacity:.16;transition:opacity .2s}
.n8n-node.tour-focus .node-shape{stroke:#7c5cc4;stroke-width:3}
@media (prefers-reduced-motion: reduce){.n8n-node.tour-dim,.n8n-edge.tour-dim,.n8n-note.tour-dim,.n8n-frame.tour-dim{transition:none}}
`;
}

function tourScript() {
  return `
  // --- Tour: step through the map's own narrative -----------------------
  var TOUR_STEPS = (SOURCE_DOC && Array.isArray(SOURCE_DOC.tour) ? SOURCE_DOC.tour.slice() : [])
    .sort(function(a, b){ return a.order - b.order; });
  var TOUR_MAX_SCALE = ${TOUR_MAX_SCALE};
  var TOUR_FRAME_PAD = ${TOUR_FRAME_PAD};
  var tourStartBtn = document.getElementById('tour-start');
  var tourPanel = document.getElementById('tour-panel');
  var tourIndex = -1;
  var tourSavedLayers = null;

  // Which note ids hang off which node, from the source document, so a note
  // about a spotlighted node stays lit with it.
  var tourNoteTargets = Object.create(null);
  (SOURCE_DOC && Array.isArray(SOURCE_DOC.notes) ? SOURCE_DOC.notes : []).forEach(function(n){
    tourNoteTargets[n.id] = Array.isArray(n.attachTo) ? n.attachTo : [];
  });

  function tourFocusSet(step){
    var set = Object.create(null);
    (Array.isArray(step.nodeIds) ? step.nodeIds : []).forEach(function(id){ set[id] = true; });
    return set;
  }

  // Turn ON any layer a spotlighted node needs. Never turns one off: the
  // tour adds what it needs to show and nothing else.
  function tourRevealLayers(focus){
    var changed = false;
    nodes.forEach(function(n){
      if (!focus[n.dataset.id] || !n.classList.contains('hidden-by-layer')) return;
      var layers = (n.dataset.layers || '').split(' ');
      checkboxes.forEach(function(cb){
        if (!cb.checked && layers.indexOf(cb.dataset.layer) !== -1) { cb.checked = true; changed = true; }
      });
    });
    if (changed) applyLayers();
  }

  function tourSpotlight(focus){
    nodes.forEach(function(n){
      var on = !!focus[n.dataset.id];
      n.classList.toggle('tour-focus', on);
      n.classList.toggle('tour-dim', !on);
    });
    edges.forEach(function(e){
      e.classList.toggle('tour-dim', !(focus[e.dataset.from] && focus[e.dataset.to]));
    });
    frames.forEach(function(f){
      var holds = nodes.some(function(n){ return focus[n.dataset.id] && n.dataset.group === f.dataset.group; });
      f.classList.toggle('tour-dim', !holds);
    });
    notes.forEach(function(el){
      var targets = tourNoteTargets[el.dataset.id] || [];
      el.classList.toggle('tour-dim', !targets.some(function(t){ return focus[t]; }));
    });
  }

  function tourClearSpotlight(){
    [nodes, edges, frames, notes].forEach(function(list){
      list.forEach(function(el){ el.classList.remove('tour-dim', 'tour-focus'); });
    });
  }

  // Move the camera -- and only the camera -- to frame the step's nodes,
  // with their label strip. Coordinates are layout's; nothing is moved.
  function tourFrame(focus){
    var box = null;
    Object.keys(focus).forEach(function(id){
      var b = GEOMETRY.nodeBoxes[id];
      if (!b) return;
      var bottom = b.y + b.h + (GEOMETRY.labelReserve || 0);
      if (!box) { box = { x: b.x, y: b.y, right: b.x + b.w, bottom: bottom }; return; }
      box.x = Math.min(box.x, b.x);
      box.y = Math.min(box.y, b.y);
      box.right = Math.max(box.right, b.x + b.w);
      box.bottom = Math.max(box.bottom, bottom);
    });
    if (!box) return;
    var rect = stage.getBoundingClientRect();
    // Leave the panel's height clear at the bottom of the screen.
    var panelSpace = tourPanel ? tourPanel.getBoundingClientRect().height + 96 : 0;
    var w = box.right - box.x, h = box.bottom - box.y;
    var sx = (rect.width - TOUR_FRAME_PAD * 2) / Math.max(w, 1);
    var sy = (rect.height - panelSpace - TOUR_FRAME_PAD * 2) / Math.max(h, 1);
    var scale = Math.max(MIN_SCALE, Math.min(TOUR_MAX_SCALE, sx, sy));
    state.scale = scale;
    state.x = rect.width / 2 - (box.x + w / 2) * scale;
    state.y = (rect.height - panelSpace) / 2 - (box.y + h / 2) * scale;
    apply();
  }

  function tourShow(i){
    if (i < 0 || i >= TOUR_STEPS.length) return;
    tourIndex = i;
    var step = TOUR_STEPS[i];
    var focus = tourFocusSet(step);
    tourRevealLayers(focus);
    tourSpotlight(focus);
    document.getElementById('tour-progress').textContent = 'Step ' + (i + 1) + ' of ' + TOUR_STEPS.length;
    document.getElementById('tour-title').textContent = String(step.title || '');
    document.getElementById('tour-text').textContent = String(step.description || '');
    document.getElementById('tour-prev').disabled = i === 0;
    document.getElementById('tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
    tourFrame(focus);
  }

  function tourStart(){
    if (!TOUR_STEPS.length || !tourPanel) return;
    if (typeof hideCard === 'function') hideCard();
    tourSavedLayers = checkboxes.map(function(cb){ return cb.checked; });
    document.body.classList.add('is-touring');
    tourPanel.hidden = false;
    tourShow(0);
    document.getElementById('tour-next').focus();
  }

  // Leaving puts every layer back exactly as the reader had it, and the
  // camera back on the view the map opens with.
  function tourEnd(){
    if (tourIndex === -1) return;
    tourIndex = -1;
    tourClearSpotlight();
    if (tourSavedLayers) {
      checkboxes.forEach(function(cb, i){ cb.checked = tourSavedLayers[i]; });
      applyLayers();
    }
    tourSavedLayers = null;
    tourPanel.hidden = true;
    document.body.classList.remove('is-touring');
    openView();
    if (tourStartBtn) tourStartBtn.focus();
  }

  if (tourStartBtn && tourPanel) {
    tourStartBtn.addEventListener('click', tourStart);
    document.getElementById('tour-exit').addEventListener('click', tourEnd);
    document.getElementById('tour-prev').addEventListener('click', function(){ tourShow(tourIndex - 1); });
    document.getElementById('tour-next').addEventListener('click', function(){
      if (tourIndex >= TOUR_STEPS.length - 1) tourEnd(); else tourShow(tourIndex + 1);
    });
    document.addEventListener('keydown', function(e){
      if (tourIndex === -1) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { e.preventDefault(); tourEnd(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (tourIndex < TOUR_STEPS.length - 1) tourShow(tourIndex + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (tourIndex > 0) tourShow(tourIndex - 1); }
    });
  }
`;
}

module.exports = {
  tourSteps,
  tourButtonMarkup,
  tourPanelMarkup,
  tourCss,
  tourScript,
  TOUR_MAX_SCALE,
  TOUR_FRAME_PAD,
};
