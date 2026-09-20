// CSS + the pan/zoom viewer + layer-toggle + details-card script. Everything
// here is inlined into the output file — no external requests, per
// docs/SPEC.md ("Output ... No build step, no server, no dependencies").
//
// This is the file's SINGLE <script> element (render.js emits exactly one).
// The details-card data is embedded here too, as a JSON literal, so the
// output keeps exactly one <script> tag rather than gaining a second one —
// see docs/design/n8n-visual-style.md "Details card" ("Security").

const { CANVAS_FILL, NOTE_FONT_SIZE, NOTE_H1_SIZE, NOTE_H2_SIZE } = require('./constants');
const { correctOpsSource, correctCss, correctScript } = require('./render-correct');

// Safe to serialise any value into an inline <script>: JSON.stringify alone
// does not escape "<", ">", "&", U+2028 or U+2029, so a string value
// containing e.g. "</script>", U+2028 (which JS treats as a line
// terminator even inside a string literal in older engines) would
// otherwise corrupt or terminate the script early. Used for both the
// (numeric-only) canvas object and the details-card data, which DOES carry
// untrusted free text (node/edge description, link, prompt, rationale).
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// `opts.fragment`: appends one extra rule after the normal sheet, setting an
// explicit background on the map root (`#stage`, which is already
// `position:fixed;inset:0` so it covers the full viewport with or without a
// `<body>`). Needed because the fragment build (renderMap(doc, { fragment:
// true })) has no `<html>`/`<body>` for the `html,body{background:...}` rule
// above to land on — the artifact skeleton around it may not share that
// background. Called with no args (the default) this returns EXACTLY the
// previous string, byte for byte — tests/n8n-render-golden.test.js pins the
// full-document output and must not change.
function css(opts = {}) {
  const sheet = `
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

.n8n-node,.n8n-edge{outline:none}
.n8n-node:focus-visible .node-shape{stroke:#5b8dd9;outline:2px solid #5b8dd9;outline-offset:2px}
.n8n-edge:focus-visible .edge-line{stroke:#5b8dd9}
.n8n-node:focus:not(:focus-visible),.n8n-edge:focus:not(:focus-visible){outline:none}

.n8n-node,.n8n-edge,.n8n-frame{transition:opacity .15s}
#stage.has-highlight .n8n-node:not(.is-highlighted),
#stage.has-highlight .n8n-edge:not(.is-highlighted){opacity:.25}

.n8n-edge .edge-line{transition:stroke .12s}
.n8n-edge:hover .edge-line,.n8n-edge.is-highlighted .edge-line{stroke:#8f8f8f}
.n8n-edge .edge-hit{cursor:pointer}
.n8n-node{cursor:pointer}

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
.layer-bar label.is-notes{padding-left:14px;margin-left:2px;border-left:1px solid rgba(0,0,0,.12)}

.zoom-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:999px;padding:6px;display:flex;gap:4px;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.zoom-bar button{width:34px;height:34px;border-radius:999px;border:none;background:transparent;font-size:16px;line-height:1;cursor:pointer;color:#444;display:flex;align-items:center;justify-content:center}
.zoom-bar button:hover{background:rgba(0,0,0,.06)}
.zoom-bar button:active{background:rgba(0,0,0,.1)}

.details-card{position:fixed;left:0;top:0;max-width:300px;max-height:70vh;overflow:auto;background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 14px;font-size:13px;line-height:1.5;color:#333;z-index:1000}
.details-card[hidden]{display:none}
.card-title{font-size:14px;font-weight:600;color:#222}
.card-sublabel{font-size:12px;color:#888;margin-top:2px}
.card-badges{margin:8px 0}
.card-badge{display:inline-block;padding:2px 8px;margin:0 4px 4px 0;border-radius:999px;font-size:11px;font-weight:600;background:#f1f1ef;color:#555}
.card-badge-status-open{background:#f3f3f3;color:#9c9c97;border:1px dashed #9c9c97}
.card-badge-status-suggested{background:#7c5cc4;color:#ffffff}
.card-description{margin:8px 0;white-space:pre-wrap}
.card-note{margin:8px 0;font-style:italic;color:#555}
.card-section-title{margin:10px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#888}
.card-connection-list{margin:0 0 4px;padding-left:16px}
.card-connection-list li{margin-bottom:4px}
.card-hidden-tag{color:#aaa;font-style:italic}
.card-connection-detail{color:#666}
.card-link{display:inline-block;margin-top:8px;color:#2f5fb0;text-decoration:underline;font-weight:600}

${correctCss()}
@media (prefers-reduced-motion: reduce){
.n8n-node,.n8n-edge,.n8n-frame,.n8n-note rect,.n8n-edge .edge-line{transition:none!important}
.correct-panel,.correct-bar button,.card-edit button{transition:none!important}
}
`;
  if (!opts.fragment) return sheet;
  return `${sheet}#stage{background:${CANVAS_FILL}}\n`;
}

function script(canvas, cardData, geometry, doc, opts = {}) {
  // An empty document keeps the signature usable from a test that only
  // wants the script text; a real render always passes the validated doc.
  const sourceDoc = doc || { title: '', nodes: [], edges: [] };
  return `
(function(){
  var stage = document.getElementById('stage');
  var viewport = document.getElementById('viewport');
  var CANVAS = ${safeJson(canvas)};
  // The validated document this map was rendered from, so correction mode
  // can write a corrected one: the card data alone cannot be turned back
  // into a document (it drops icon, source, cites, integration, group ids
  // and note bodies). Measured cost on the Medusa fixture: 23kb against a
  // 149kb render. See docs/design/correction-mode.md.
  var SOURCE_DOC = ${safeJson(sourceDoc)};
  var FRAGMENT_MODE = ${opts.fragment ? 'true' : 'false'};
  // Numeric-only: node boxes plus the frame padding/label-reserve/grid
  // constants layout.js used, so the viewer can recompute a frame's box
  // for its currently-visible members with frameBoxFromMemberBoxes()
  // below -- see src/n8n/frame-box.js and render.js's buildGeometryData().
  var GEOMETRY = ${safeJson(geometry)};
  var state = { x: 0, y: 0, scale: 1 };
  var MIN_SCALE = 0.1, MAX_SCALE = 4;
  var CLICK_MOVE_THRESHOLD = 6;

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

  // --- Element collections, queried once up front so both the layer
  // toggler and the details-card interactions below share them. ---------
  var nodes = [].slice.call(document.querySelectorAll('.n8n-node'));
  var frames = [].slice.call(document.querySelectorAll('.n8n-frame'));
  var edges = [].slice.call(document.querySelectorAll('.n8n-edge'));
  var notes = [].slice.call(document.querySelectorAll('.n8n-note'));
  var noteLinkEls = [].slice.call(document.querySelectorAll('.note-link'));
  var checkboxes = [].slice.call(document.querySelectorAll('input[data-layer]'));
  var notesToggle = document.querySelector('input[data-notes]');
  var handleEls = [].slice.call(document.querySelectorAll('.handle'));
  var branchLabelEls = [].slice.call(document.querySelectorAll('.branch-label'));

  // Object.create(null), not {}: a node id is author-controlled and
  // ID_RE allows "__proto__" (and "constructor", "toString", ...) as a
  // legal id. Keying a plain {} by an attacker-chosen id like that would
  // reach the object's prototype chain instead of storing an own
  // property, so this and every other id-keyed lookup below uses a
  // null-prototype object or a Map.
  var nodeElsById = Object.create(null);
  nodes.forEach(function(n){ nodeElsById[n.dataset.id] = n; });

  // Every branch (condition) edge's index, so a plain "out" handle's
  // membership computation (below) can exclude edges that have their own
  // dedicated branch handle instead of sharing the main-out dot.
  var branchEdgeIndexes = {};
  handleEls.forEach(function(h){ if (h.dataset.role === 'branch') branchEdgeIndexes[h.dataset.edgeIndex] = true; });

  // --- Pan via Pointer Events (covers mouse, touch, pen) plus pinch-zoom
  // when a second pointer joins, and click/tap detection for the details
  // card: a press that moves more than CLICK_MOVE_THRESHOLD before release
  // is a drag, not a click, so dragging the canvas never pins a card. -----
  var pointers = new Map();
  var lastPan = null;
  var pinchStartDist = null;
  var pinchStartScale = null;
  var press = null; // { x, y, target, moved, pointerId }

  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }

  function closestInteractive(target){
    if (!target || !target.closest) return null;
    return target.closest('.n8n-node') || target.closest('.n8n-edge');
  }

  stage.addEventListener('pointerdown', function(e){
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      lastPan = { x: e.clientX, y: e.clientY };
      stage.classList.add('is-panning');
      press = { x: e.clientX, y: e.clientY, target: closestInteractive(e.target), moved: false, pointerId: e.pointerId };
    } else if (pointers.size === 2) {
      press = null;
      var pts = [...pointers.values()];
      pinchStartDist = dist(pts[0], pts[1]);
      pinchStartScale = state.scale;
    }
  });

  stage.addEventListener('pointermove', function(e){
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && press.pointerId === e.pointerId && !press.moved) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_MOVE_THRESHOLD) press.moved = true;
    }
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
    if (press && press.pointerId === e.pointerId) {
      if (!press.moved) {
        if (press.target) pinCard(press.target);
        else unpinCard();
      }
      press = null;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) { pinchStartDist = null; }
    if (pointers.size === 0) { lastPan = null; stage.classList.remove('is-panning'); }
    else if (pointers.size === 1) { var only = [...pointers.values()][0]; lastPan = only; }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', function(e){ press = null; endPointer(e); });
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

  // --- Layer visibility -----------------------------------------------
  //
  // Owner decision (2026-09-15), overriding SPEC.md's per-edge "stub"
  // rule for this renderer: an edge is visible only when BOTH endpoints
  // are visible. This is the single-source-of-truth copy of
  // src/n8n/edge-visibility.js's isEdgeVisible() — the browser cannot
  // require() that module, so the identical one-line body is inlined
  // here; tests/n8n-edge-visibility.test.js exercises the Node copy.
  function isEdgeVisible(fromVisible, toVisible){
    return !!fromVisible && !!toVisible;
  }

  // Single-source-of-truth copy of src/n8n/handle-visibility.js's
  // isHandleVisible() (same reason as isEdgeVisible above): a handle is
  // visible iff at least one edge attached to it is visible.
  function isHandleVisible(attachedEdgeVisibilities){
    return attachedEdgeVisibilities.some(Boolean);
  }

  // Single-source-of-truth copy of src/n8n/frame-box.js's
  // frameBoxFromMemberBoxes() (same reason as isEdgeVisible above): the
  // bounding box of a frame's member node boxes, padded and snapped to
  // the grid.
  function frameBoxFromMemberBoxes(memberBoxes, opts){
    var labelReserve = opts.labelReserve, padding = opts.padding, grid = opts.grid;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    memberBoxes.forEach(function(b){
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h + labelReserve);
    });
    var x = Math.floor((minX - padding.left) / grid) * grid;
    var y = Math.floor((minY - padding.top) / grid) * grid;
    var right = Math.ceil((maxX + padding.right) / grid) * grid;
    var bottom = Math.ceil((maxY + padding.bottom) / grid) * grid;
    return { x: x, y: y, w: right - x, h: bottom - y };
  }

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
    var visible = Object.create(null); // keyed by node id -- see nodeElsById above
    nodes.forEach(function(n){
      var on = nodeVisible(n, active);
      visible[n.dataset.id] = on;
      n.classList.toggle('hidden-by-layer', !on);
      n.setAttribute('tabindex', on ? '0' : '-1');
      if (!on) closeIfShowing(n);
    });

    edges.forEach(function(e){
      // Both endpoints' VISIBILITY (not just their existence), including a
      // node hidden because its own layer is off even while the group
      // frame it sits in stays visible thanks to another member.
      var edgeOn = isEdgeVisible(visible[e.dataset.from], visible[e.dataset.to]);
      e.classList.toggle('hidden-by-layer', !edgeOn);
      e.setAttribute('tabindex', edgeOn ? '0' : '-1');
      if (!edgeOn) closeIfShowing(e);
    });

    // Frames never move a node, but shrink to the bounding box of
    // whichever members are currently visible (frameBoxFromMemberBoxes,
    // same computation layout.js used originally) -- and hide entirely
    // when none of their members are. The title moves with the box.
    var frameVisible = Object.create(null); // keyed by group id -- see nodeElsById above
    frames.forEach(function(f){
      // Filter the already-cached node list by dataset equality instead of
      // building a CSS selector string from data — a group id containing a
      // quote would otherwise break out of the attribute selector.
      var members = nodes.filter(function(n){ return n.dataset.group === f.dataset.group; });
      var visibleMembers = members.filter(function(n){ return visible[n.dataset.id]; });
      if (!visibleMembers.length) {
        frameVisible[f.dataset.group] = false;
        f.classList.toggle('hidden-by-layer', true);
        return;
      }
      frameVisible[f.dataset.group] = true;
      f.classList.toggle('hidden-by-layer', false);
      var memberBoxes = visibleMembers.map(function(n){ return GEOMETRY.nodeBoxes[n.dataset.id]; });
      var box = frameBoxFromMemberBoxes(memberBoxes, { labelReserve: GEOMETRY.labelReserve, padding: GEOMETRY.padding, grid: GEOMETRY.grid });
      var rect = f.querySelector('rect');
      rect.setAttribute('x', box.x);
      rect.setAttribute('y', box.y);
      rect.setAttribute('width', box.w);
      rect.setAttribute('height', box.h);
      var label = f.querySelector('.frame-label');
      label.setAttribute('x', box.x + GEOMETRY.frameLabelOffsetX);
      label.setAttribute('y', box.y + GEOMETRY.frameLabelOffsetY);
    });

    // Handles: a shared main-in/main-out dot is visible iff at least one
    // of the edges attached to it is visible; a branch dot (and its
    // condition label) follows its own single edge. A hidden node's own
    // handles fall out of this for free, since every edge touching it is
    // itself hidden on that end (see isEdgeVisible above).
    var edgeVisibleByIndex = {};
    edges.forEach(function(e){ edgeVisibleByIndex[e.dataset.index] = !e.classList.contains('hidden-by-layer'); });

    handleEls.forEach(function(h){
      var role = h.dataset.role;
      var attached;
      if (role === 'in') {
        attached = edges.filter(function(e){ return e.dataset.to === h.dataset.node; }).map(function(e){ return edgeVisibleByIndex[e.dataset.index]; });
      } else if (role === 'out') {
        attached = edges.filter(function(e){ return e.dataset.from === h.dataset.node && !branchEdgeIndexes[e.dataset.index]; }).map(function(e){ return edgeVisibleByIndex[e.dataset.index]; });
      } else {
        attached = [edgeVisibleByIndex[h.dataset.edgeIndex]];
      }
      h.classList.toggle('hidden-by-layer', !isHandleVisible(attached));
    });

    branchLabelEls.forEach(function(t){
      t.classList.toggle('hidden-by-layer', !isHandleVisible([edgeVisibleByIndex[t.dataset.edgeIndex]]));
    });

    // A note's visibility depends only on its own layers (same rule as a
    // node — shown when any of its layers is active), independent of
    // whatever it is attached to.
    // ...and on the Notes control, a second axis over the top of that:
    // off hides every note whatever its layers say, on restores each note
    // to what its own layers allow.
    var notesOn = !notesToggle || notesToggle.checked;
    notes.forEach(function(n){
      n.classList.toggle('hidden-by-layer', !notesOn || !nodeVisible(n, active));
    });

    // A note's connector line -- drawn only to a target the note could not
    // be placed beside (notes.js) -- follows that TARGET's visibility, not
    // the note's. A line reaching out to a node that is no longer on
    // screen is exactly the leftover the owner's layer rule forbids. The
    // note itself stays put either way, since a note's visibility depends
    // only on its own layers; and a connector belonging to a hidden note
    // is already gone with that note's own <g>.
    noteLinkEls.forEach(function(l){
      var id = l.dataset.target;
      var on = (id in visible) ? visible[id] : ((id in frameVisible) ? frameVisible[id] : true);
      l.classList.toggle('hidden-by-layer', !notesOn || !on);
    });
  }

  checkboxes.forEach(function(cb){ cb.addEventListener('change', applyLayers); });
  if (notesToggle) notesToggle.addEventListener('change', applyLayers);

  // --- Details card -----------------------------------------------------
  //
  // docs/design/n8n-visual-style.md "Details card (hover, tap or
  // keyboard)". Card content is written to the DOM only through
  // textContent / createElement / setAttribute — no innerHTML,
  // outerHTML, insertAdjacentHTML, document.write or eval anywhere in
  // this script (tests/n8n-security.test.js asserts that statically).
  var CARD_DATA = ${safeJson(cardData)};
  var nodeCardsById = Object.create(null); // keyed by node id -- see nodeElsById above
  CARD_DATA.nodes.forEach(function(n){ nodeCardsById[n.id] = n; });

  var card = document.getElementById('details-card');
  var pinnedEl = null;
  var shownEl = null;
  var hoverTimer = null;
  var HOVER_DELAY = 150;

  function nodeCardFor(el){ return nodeCardsById[el.dataset.id]; }
  function edgeCardFor(el){ return CARD_DATA.edges[parseInt(el.dataset.index, 10)]; }

  function clearCard(){
    while (card.firstChild) card.removeChild(card.firstChild);
  }

  function makeBadge(text, modifier){
    var span = document.createElement('span');
    span.className = 'card-badge' + (modifier ? ' card-badge-' + modifier : '');
    span.textContent = text;
    return span;
  }

  function buildConnectionItem(entry){
    var li = document.createElement('li');
    var label = document.createElement('span');
    label.textContent = entry.label;
    li.appendChild(label);
    var otherEl = nodeElsById[entry.nodeId];
    if (otherEl && otherEl.classList.contains('hidden-by-layer')) {
      var hiddenTag = document.createElement('span');
      hiddenTag.className = 'card-hidden-tag';
      hiddenTag.textContent = ' (hidden)';
      li.appendChild(hiddenTag);
    }
    var detail = entry.condition || entry.edgeDescription;
    if (detail) {
      var detailSpan = document.createElement('span');
      detailSpan.className = 'card-connection-detail';
      detailSpan.textContent = ' — ' + detail;
      li.appendChild(detailSpan);
    }
    return li;
  }

  function appendConnectionSection(title, list){
    if (!list.length) return;
    var heading = document.createElement('p');
    heading.className = 'card-section-title';
    heading.textContent = title;
    card.appendChild(heading);
    var ul = document.createElement('ul');
    ul.className = 'card-connection-list';
    list.forEach(function(entry){ ul.appendChild(buildConnectionItem(entry)); });
    card.appendChild(ul);
  }

  function appendDocsLink(url){
    // Defence in depth: validate.js already rejected anything but a clean
    // http(s) URL at authoring time, but this re-checks client-side,
    // immediately before the value is ever used as an href, per
    // docs/design/n8n-visual-style.md.
    if (!url || !/^https?:\\/\\//i.test(url)) return;
    var a = document.createElement('a');
    a.className = 'card-link';
    a.textContent = 'Docs ↗';
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    card.appendChild(a);
  }

  function buildNodeCard(entry){
    clearCard();
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = entry.label;
    card.appendChild(title);

    if (entry.sublabel) {
      var sub = document.createElement('div');
      sub.className = 'card-sublabel';
      sub.textContent = entry.sublabel;
      card.appendChild(sub);
    }

    var badges = document.createElement('div');
    badges.className = 'card-badges';
    badges.appendChild(makeBadge(entry.kind, 'kind'));
    if (entry.group) badges.appendChild(makeBadge(entry.group, 'group'));
    entry.layers.forEach(function(l){ badges.appendChild(makeBadge(l, 'layer')); });
    if (entry.status && entry.status !== 'confirmed') badges.appendChild(makeBadge(entry.status, 'status-' + entry.status));
    card.appendChild(badges);

    if (entry.description) {
      var desc = document.createElement('p');
      desc.className = 'card-description';
      desc.textContent = entry.description;
      card.appendChild(desc);
    }

    if (entry.prompt) {
      var p = document.createElement('p');
      p.className = 'card-note';
      p.textContent = 'Open question: ' + entry.prompt;
      card.appendChild(p);
    }

    if (entry.rationale) {
      var r = document.createElement('p');
      r.className = 'card-note';
      r.textContent = 'Why suggested: ' + entry.rationale;
      card.appendChild(r);
    }

    appendConnectionSection('Receives from', entry.receivesFrom);
    appendConnectionSection('Sends to', entry.sendsTo);
    appendDocsLink(entry.link);
  }

  var EDGE_TYPE_MEANING = {
    solid: 'Solid: always happens.',
    dashed: 'Dashed: conditional, retry or return.',
    gutter: 'Gutter: cross-group link.',
  };

  function buildEdgeCard(entry){
    clearCard();
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = entry.fromLabel + ' → ' + entry.toLabel;
    card.appendChild(title);

    var meaning = document.createElement('p');
    meaning.className = 'card-description';
    meaning.textContent = EDGE_TYPE_MEANING[entry.type] || entry.type;
    card.appendChild(meaning);

    if (entry.condition) {
      var c = document.createElement('p');
      c.className = 'card-note';
      c.textContent = 'Condition: ' + entry.condition;
      card.appendChild(c);
    }

    if (entry.description) {
      var d = document.createElement('p');
      d.className = 'card-description';
      d.textContent = entry.description;
      card.appendChild(d);
    }
  }

  function highlightFor(el){
    clearHighlight();
    if (!el) return;
    if (el.classList.contains('n8n-node')) {
      var id = el.dataset.id;
      el.classList.add('is-highlighted');
      edges.forEach(function(edgeEl){
        if (edgeEl.classList.contains('hidden-by-layer')) return;
        if (edgeEl.dataset.from === id || edgeEl.dataset.to === id) {
          edgeEl.classList.add('is-highlighted');
          var otherId = edgeEl.dataset.from === id ? edgeEl.dataset.to : edgeEl.dataset.from;
          var otherEl = nodeElsById[otherId];
          if (otherEl) otherEl.classList.add('is-highlighted');
        }
      });
    } else if (el.classList.contains('n8n-edge')) {
      el.classList.add('is-highlighted');
      var fromEl = nodeElsById[el.dataset.from];
      var toEl = nodeElsById[el.dataset.to];
      if (fromEl) fromEl.classList.add('is-highlighted');
      if (toEl) toEl.classList.add('is-highlighted');
    }
    stage.classList.add('has-highlight');
  }

  function clearHighlight(){
    nodes.forEach(function(n){ n.classList.remove('is-highlighted'); });
    edges.forEach(function(e){ e.classList.remove('is-highlighted'); });
    stage.classList.remove('has-highlight');
  }

  function positionCard(el){
    var margin = 12;
    var rect = el.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    // In correction mode the change list occupies the right edge, so the
    // card treats that strip as off the viewport rather than covering the
    // list the user is reading.
    var reserved = 0;
    if (correctPanel && !correctPanel.hidden) {
      var panelRect = correctPanel.getBoundingClientRect();
      reserved = Math.max(0, window.innerWidth - panelRect.left) + margin;
    }
    var vw = window.innerWidth - reserved, vh = window.innerHeight;
    var x = rect.right + margin;
    if (x + cardRect.width > vw - margin) {
      var flippedX = rect.left - margin - cardRect.width;
      x = flippedX >= margin ? flippedX : Math.max(margin, vw - margin - cardRect.width);
    }
    var y = rect.top;
    if (y + cardRect.height > vh - margin) y = Math.max(margin, vh - margin - cardRect.height);
    if (y < margin) y = margin;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  // One place that fills the card, so correction mode can rebuild a
  // pinned card in place after an operation without re-running the
  // positioning and highlighting around it.
  function buildCard(el){
    var isNode = el.classList.contains('n8n-node');
    var entry = isNode ? nodeCardFor(el) : edgeCardFor(el);
    if (!entry) return false;
    if (isNode) buildNodeCard(entry); else buildEdgeCard(entry);
    if (correcting) {
      if (isNode) correctAppendNodeEditor(card, el.dataset.id);
      else correctAppendEdgeEditor(card, parseInt(el.dataset.index, 10));
    }
    return true;
  }

  function showCard(el){
    if (!buildCard(el)) return;
    card.hidden = false;
    shownEl = el;
    highlightFor(el);
    positionCard(el);
  }

  function hideCard(){
    if (pinnedEl) return;
    card.hidden = true;
    shownEl = null;
    clearHighlight();
  }

  function pinCard(el){
    pinnedEl = el;
    showCard(el);
  }

  function unpinCard(){
    pinnedEl = null;
    hideCard();
  }

  // Called from applyLayers() when a node/edge that is currently shown or
  // pinned becomes hidden: its card must close rather than point at
  // something no longer on screen, and a hidden element cannot stay
  // pinned or focused.
  function closeIfShowing(el){
    if (pinnedEl === el) pinnedEl = null;
    if (shownEl === el) hideCard();
    if (document.activeElement === el) el.blur();
  }

  function attachInteractions(el){
    el.addEventListener('mouseenter', function(){
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function(){ showCard(el); }, HOVER_DELAY);
    });
    el.addEventListener('mouseleave', function(){
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (!pinnedEl) hideCard();
    });
    el.addEventListener('focusin', function(){ showCard(el); });
    el.addEventListener('focusout', function(){ if (!pinnedEl) hideCard(); });
    el.addEventListener('keydown', function(e){
      if (e.key === 'Enter') { e.preventDefault(); pinCard(el); }
      else if (e.key === 'Escape') { unpinCard(); el.blur(); }
    });
  }
  nodes.concat(edges).forEach(attachInteractions);

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') unpinCard();
  });

  // --- Deep link: #focus=<id> ------------------------------------------
  //
  // Opens a node or edge card pinned on load and pans it into view. A node
  // is addressed by its own id; an edge has no authored id in the IR, so
  // it is addressed as "<fromId>-><toId>". The hash value is only ever
  // compared for strict equality against cached dataset values, never
  // used to build a selector or query string.
  function panIntoView(el){
    var rect = el.getBoundingClientRect();
    var stageRect = stage.getBoundingClientRect();
    var dx = (stageRect.left + stageRect.width / 2) - (rect.left + rect.width / 2);
    var dy = (stageRect.top + stageRect.height / 2) - (rect.top + rect.height / 2);
    state.x += dx; state.y += dy;
    apply();
  }

  function applyDeepLink(){
    var m = /^#focus=(.+)$/.exec(location.hash || '');
    if (!m) return;
    var id;
    try { id = decodeURIComponent(m[1]); } catch (err) { return; }
    if (!id || id.length > 200) return;

    var target = nodes.find(function(n){ return n.dataset.id === id && !n.classList.contains('hidden-by-layer'); });
    if (!target) {
      target = edges.find(function(e){
        return (e.dataset.from + '->' + e.dataset.to) === id && !e.classList.contains('hidden-by-layer');
      });
    }
    if (!target) return;
    pinCard(target);
    panIntoView(target);
  }

${correctOpsSource()}
${correctScript()}

  fit();
  applyLayers();
  applyDeepLink();
})();
`;
}

module.exports = { css, script };
