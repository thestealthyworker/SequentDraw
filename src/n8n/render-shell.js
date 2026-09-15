// CSS + the pan/zoom viewer + layer-toggle script. Everything here is
// inlined into the output file — no external requests, per docs/SPEC.md
// ("Output ... No build step, no server, no dependencies").

const { CANVAS_FILL, NOTE_FONT_SIZE, NOTE_H1_SIZE, NOTE_H2_SIZE } = require('./constants');

// Safe to serialise any value into an inline <script>: JSON.stringify alone
// does not escape "<", so a string value containing "</script>" would
// otherwise terminate the tag early. `canvas` is numeric-only today, but
// this keeps the inline script safe by construction rather than by
// convention if that ever changes.
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function css() {
  return `
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:${CANVAS_FILL};overflow:hidden}
body{font-family:Inter,system-ui,-apple-system,sans-serif;color:#333}
#stage{position:fixed;inset:0;touch-action:none;cursor:grab}
#stage.is-panning{cursor:grabbing}
#stage svg{display:block;width:100%;height:100%}
#viewport{will-change:transform}

.n8n-frame rect{transition:opacity .15s}
.frame-label{font-size:13px;font-weight:600;font-family:inherit}
.node-label{font-size:16px;font-weight:500;fill:#333;text-anchor:middle;font-family:inherit}
.node-sublabel{font-size:13px;font-weight:400;fill:#888;font-family:inherit}
.badge-glyph{font-size:11px;font-weight:700;font-family:inherit}
.branch-label{font-size:12px;fill:#555;font-family:inherit;paint-order:stroke;stroke:${CANVAS_FILL};stroke-width:3px}
.handle-branch{cursor:default}

.n8n-edge .edge-line{transition:stroke .12s}
.n8n-edge:hover .edge-line{stroke:#8f8f8f}
.n8n-edge .edge-hit{cursor:pointer}
.edge-stub{fill:#c4c4c4;stroke:#ffffff;stroke-width:1.5;display:none}
.n8n-edge.show-stub-start .stub-start,
.n8n-edge.show-stub-end .stub-end{display:block}

.n8n-note rect{transition:opacity .15s}
.note-text{font-size:${NOTE_FONT_SIZE}px;fill:#3a3a35;font-family:inherit}
.note-text .note-h1{font-size:${NOTE_H1_SIZE}px;font-weight:700}
.note-text .note-h2{font-size:${NOTE_H2_SIZE}px;font-weight:700}
.note-bold{font-weight:700}
.note-italic{font-style:italic}
.note-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.note-text a{fill:#2f5fb0;text-decoration:underline;cursor:pointer}

.hidden-by-layer{display:none}

.title-bar{position:fixed;top:16px;left:16px;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.08);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.06);max-width:min(50vw,420px)}

.layer-bar{position:fixed;top:16px;right:16px;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.08);border-radius:999px;padding:8px 14px;display:flex;gap:14px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.06);flex-wrap:wrap;max-width:min(70vw,560px)}
.layer-bar label{display:flex;align-items:center;gap:6px;font-size:12px;color:#555;cursor:pointer;white-space:nowrap}
.layer-bar input{accent-color:#7c5cc4;margin:0}
.layer-bar label.is-locked{cursor:default;color:#333}

.zoom-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:999px;padding:6px;display:flex;gap:4px;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.zoom-bar button{width:34px;height:34px;border-radius:999px;border:none;background:transparent;font-size:16px;line-height:1;cursor:pointer;color:#444;display:flex;align-items:center;justify-content:center}
.zoom-bar button:hover{background:rgba(0,0,0,.06)}
.zoom-bar button:active{background:rgba(0,0,0,.1)}
`;
}

function script(canvas) {
  return `
(function(){
  var stage = document.getElementById('stage');
  var viewport = document.getElementById('viewport');
  var CANVAS = ${safeJson(canvas)};
  var state = { x: 0, y: 0, scale: 1 };
  var MIN_SCALE = 0.1, MAX_SCALE = 4;

  function apply(){
    viewport.setAttribute('transform', 'translate(' + state.x + ' ' + state.y + ') scale(' + state.scale + ')');
  }

  function fit(){
    var rect = stage.getBoundingClientRect();
    var pad = 32;
    var sx = (rect.width - pad * 2) / CANVAS.width;
    var sy = (rect.height - pad * 2) / CANVAS.height;
    var scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
    state.scale = scale;
    state.x = rect.width / 2 - (CANVAS.x + CANVAS.width / 2) * scale;
    state.y = rect.height / 2 - (CANVAS.y + CANVAS.height / 2) * scale;
    apply();
  }

  function zoomAt(clientX, clientY, factor){
    var rect = stage.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var worldX = (px - state.x) / state.scale;
    var worldY = (py - state.y) / state.scale;
    state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.scale * factor));
    state.x = px - worldX * state.scale;
    state.y = py - worldY * state.scale;
    apply();
  }

  // Pan via Pointer Events (covers mouse, touch, pen) plus pinch-zoom when
  // a second pointer joins.
  var pointers = new Map();
  var lastPan = null;
  var pinchStartDist = null;
  var pinchStartScale = null;

  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }

  stage.addEventListener('pointerdown', function(e){
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      lastPan = { x: e.clientX, y: e.clientY };
      stage.classList.add('is-panning');
    } else if (pointers.size === 2) {
      var pts = [...pointers.values()];
      pinchStartDist = dist(pts[0], pts[1]);
      pinchStartScale = state.scale;
    }
  });

  stage.addEventListener('pointermove', function(e){
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = [...pointers.values()];
      var d = dist(pts[0], pts[1]);
      if (pinchStartDist) {
        var factor = (d / pinchStartDist) * pinchStartScale / state.scale;
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        zoomAt(cx, cy, factor);
      }
      return;
    }
    if (pointers.size === 1 && lastPan) {
      var dx = e.clientX - lastPan.x, dy = e.clientY - lastPan.y;
      state.x += dx; state.y += dy;
      lastPan = { x: e.clientX, y: e.clientY };
      apply();
    }
  });

  function endPointer(e){
    pointers.delete(e.pointerId);
    if (pointers.size < 2) { pinchStartDist = null; }
    if (pointers.size === 0) { lastPan = null; stage.classList.remove('is-panning'); }
    else if (pointers.size === 1) { var only = [...pointers.values()][0]; lastPan = only; }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', function(e){ if (pointers.size <= 1) endPointer(e); });

  stage.addEventListener('wheel', function(e){
    e.preventDefault();
    var factor = Math.pow(1.0015, -e.deltaY);
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  document.getElementById('zoom-in').addEventListener('click', function(){
    var rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
  });
  document.getElementById('zoom-out').addEventListener('click', function(){
    var rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
  });
  document.getElementById('zoom-fit').addEventListener('click', fit);

  window.addEventListener('resize', fit);
  fit();

  // --- Layer visibility -----------------------------------------------
  var checkboxes = [].slice.call(document.querySelectorAll('input[data-layer]'));
  var nodes = [].slice.call(document.querySelectorAll('.n8n-node'));
  var frames = [].slice.call(document.querySelectorAll('.n8n-frame'));
  var edges = [].slice.call(document.querySelectorAll('.n8n-edge'));
  var notes = [].slice.call(document.querySelectorAll('.n8n-note'));

  function activeLayers(){
    var set = {};
    checkboxes.forEach(function(cb){ if (cb.checked) set[cb.dataset.layer] = true; });
    set.base = true;
    return set;
  }

  function nodeVisible(node, active){
    var layers = (node.dataset.layers || 'base').split(' ');
    return layers.some(function(l){ return active[l]; });
  }

  function applyLayers(){
    var active = activeLayers();
    var visible = {};
    nodes.forEach(function(n){
      var on = nodeVisible(n, active);
      visible[n.dataset.id] = on;
      n.classList.toggle('hidden-by-layer', !on);
    });
    frames.forEach(function(f){
      // Filter the already-cached node list by dataset equality instead of
      // building a CSS selector string from data — a group id containing a
      // quote would otherwise break out of the attribute selector.
      var members = nodes.filter(function(n){ return n.dataset.group === f.dataset.group; });
      var anyVisible = members.some(function(n){ return visible[n.dataset.id]; });
      f.classList.toggle('hidden-by-layer', !anyVisible);
    });
    edges.forEach(function(e){
      var fromOn = visible[e.dataset.from];
      var toOn = visible[e.dataset.to];
      e.classList.toggle('hidden-by-layer', !fromOn && !toOn);
      e.classList.toggle('show-stub-start', !fromOn && toOn);
      e.classList.toggle('show-stub-end', fromOn && !toOn);
    });
    // A note's visibility depends only on its own layers (same rule as a
    // node — shown when any of its layers is active), independent of
    // whatever it is attached to.
    notes.forEach(function(n){
      n.classList.toggle('hidden-by-layer', !nodeVisible(n, active));
    });
  }

  checkboxes.forEach(function(cb){ cb.addEventListener('change', applyLayers); });
  applyLayers();
})();
`;
}

module.exports = { css, script };
