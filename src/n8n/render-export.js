// Export from the viewer: the map as it stands on screen, as an SVG image
// or a PNG (owner request, 2026-09-20).
//
// This is NOT the documentation export. `doc-map` / renderSvg() lays the
// map out again with room for full captions under every node, because a
// figure in a slide has nobody to hover. This one is a picture of what the
// reader is looking at: their layer choices, their Notes setting, the same
// coordinates, no captions. Two different jobs, and the viewer says which
// is which.
//
// No dependency and no network: the page serialises its own inline SVG,
// and the PNG is that SVG drawn once into a canvas. The SVG carries no
// external reference of any kind (every icon is an inline path, fonts come
// from the system stack), so the canvas is never tainted and toBlob works.

const EXPORT_PNG_SCALE = 2;
const EXPORT_PNG_MAX_PX = 8000;
// The status key's row in an exported file (docs/design/n8n-visual-style.md
// "Status key"): a swatch the size of the on-screen one, centred in a row
// added under the content only when an entry is on screen.
const EXPORT_KEY_SWATCH = 20;
const EXPORT_KEY_ROW = 32;
const EXPORT_KEY_GAP = 20;

function exportBarMarkup() {
  return `<div class="export-bar">
<button id="export-svg" type="button" title="Export the current view as an SVG image">Export SVG</button>
<button id="export-png" type="button" title="Export the current view as a PNG image">PNG</button>
</div>`;
}

function exportCss() {
  return `
.export-bar{position:fixed;right:16px;bottom:20px;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:999px;padding:6px;display:flex;gap:2px;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.export-bar button{border:none;background:transparent;border-radius:999px;padding:6px 12px;font:inherit;font-size:12px;font-weight:600;color:#444;cursor:pointer}
.export-bar button:hover{background:rgba(0,0,0,.06)}
.export-bar button:active{background:rgba(0,0,0,.1)}
.export-bar button:focus-visible{outline:2px solid #7c5cc4;outline-offset:2px}
.export-bar button.is-busy{color:#7c5cc4}
body.is-correcting .export-bar{bottom:auto;top:16px;right:16px}
`;
}

// `styleText` is the page's own stylesheet, embedded in the exported SVG so
// it stands alone: the markup styles everything by class, and an SVG opened
// in another program has no page around it to inherit from.
function exportScript(styleText) {
  return `
  // --- Export: the current view as an image -----------------------------
  var exportSvgBtn = document.getElementById('export-svg');
  var exportPngBtn = document.getElementById('export-png');
  var EXPORT_STYLE = ${JSON.stringify(styleText)};
  var EXPORT_PNG_SCALE = ${EXPORT_PNG_SCALE};
  var EXPORT_PNG_MAX_PX = ${EXPORT_PNG_MAX_PX};

  function exportFileName(extension){
    var base = String(document.title || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'map').slice(0, 60) + '.' + extension;
  }

  // The visible content's own box, so an export is cropped to what is on
  // screen rather than to the whole graph: with a layer off, the space its
  // nodes occupied is not exported as empty margin.
  function exportVisibleBox(svgRoot){
    var pad = 32;
    var box = null;
    var parts = [].slice.call(svgRoot.querySelectorAll('.n8n-node, .n8n-frame, .n8n-edge, .n8n-note'));
    parts.forEach(function(el){
      var b;
      try { b = el.getBBox(); } catch (err) { return; }
      if (!b || (!b.width && !b.height)) return;
      if (!box) { box = { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height }; return; }
      box.x = Math.min(box.x, b.x);
      box.y = Math.min(box.y, b.y);
      box.right = Math.max(box.right, b.x + b.width);
      box.bottom = Math.max(box.bottom, b.y + b.height);
    });
    if (!box) return { x: CANVAS.x, y: CANVAS.y, width: CANVAS.width, height: CANVAS.height };
    return {
      x: box.x - pad,
      y: box.y - pad,
      width: (box.right - box.x) + pad * 2,
      height: (box.bottom - box.y) + pad * 2,
    };
  }

  // The exported file is a document the user will send to someone else, so
  // it carries only drawing. Anything executable is removed rather than
  // trusted -- including code a host page or a browser extension injected
  // into the live DOM, which is how a geolocation shim was found riding
  // along in an early version of this export. The engine's own static
  // export (render-svg-doc.js) holds to the same rule.
  function exportSanitise(root){
    var banned = root.querySelectorAll('script, foreignObject, iframe, image, use, animate, animateTransform, set');
    [].slice.call(banned).forEach(function(el){ if (el.parentNode) el.parentNode.removeChild(el); });
    var all = [root].concat([].slice.call(root.querySelectorAll('*')));
    all.forEach(function(el){
      var attrs = [].slice.call(el.attributes || []);
      attrs.forEach(function(attr){
        var name = attr.name.toLowerCase();
        if (name.indexOf('on') === 0) { el.removeAttribute(attr.name); return; }
        if (name === 'href' || name === 'xlink:href') {
          // A note may legitimately link out, and an SVG opened in a
          // browser can follow it. Anything that is not a plain http(s)
          // URL -- javascript:, data:, a relative path to a file that will
          // not travel with the image -- is dropped.
          var value = String(attr.value || '').toLowerCase();
          var allowed = value.indexOf('http://') === 0 || value.indexOf('https://') === 0;
          if (!allowed) el.removeAttribute(attr.name);
        }
      });
    });
  }

  // The status key, as it stands on screen, drawn into the exported file's
  // bottom-left corner: the file is going to someone with no details card
  // to click, which is exactly the reader the key exists for. Each entry's
  // swatch is a deep clone of the key's own inline <svg> content (plain
  // rect/circle/text with explicit attributes, so it survives without the
  // page), and the text is written through textContent. Returns null when
  // no entry is on screen, and the caller then reserves no row.
  var EXPORT_KEY_SWATCH = ${EXPORT_KEY_SWATCH};
  var EXPORT_KEY_ROW = ${EXPORT_KEY_ROW};
  var EXPORT_KEY_GAP = ${EXPORT_KEY_GAP};

  function exportKeyGroup(x, y){
    var items = [].slice.call(document.querySelectorAll('.key-item')).filter(function(item){
      return !item.classList.contains('hidden-by-layer');
    });
    if (!items.length) return null;
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'export-key');
    var cursor = x;
    items.forEach(function(item){
      var swatchSvg = item.querySelector('.key-swatch');
      var size = parseFloat(swatchSvg.getAttribute('width')) || EXPORT_KEY_SWATCH;
      var holder = document.createElementNS(SVG_NS, 'g');
      holder.setAttribute('transform', 'translate(' + cursor + ' ' + y + ')');
      [].slice.call(swatchSvg.childNodes).forEach(function(child){ holder.appendChild(child.cloneNode(true)); });
      group.appendChild(holder);
      var text = document.createElementNS(SVG_NS, 'text');
      var label = item.querySelector('.key-text').textContent + ' ' + item.querySelector('.key-count').textContent;
      text.textContent = label;
      text.setAttribute('x', String(cursor + size + 6));
      text.setAttribute('y', String(y + size - 4));
      group.appendChild(text);
      cursor += size + 6 + label.length * 12 * 0.52 + EXPORT_KEY_GAP;
    });
    return group;
  }

  // A standalone copy of the live SVG: hidden elements dropped rather than
  // carried as display:none, the pan/zoom transform undone, the page's own
  // stylesheet embedded, and a white ground behind it so it does not land
  // on black in a viewer that defaults dark.
  function exportBuildSvg(){
    var live = document.getElementById('canvas-svg');
    var clone = live.cloneNode(true);
    [].slice.call(clone.querySelectorAll('.hidden-by-layer')).forEach(function(el){
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    var viewport = clone.querySelector('#viewport');
    if (viewport) viewport.removeAttribute('transform');

    document.body.appendChild(clone);
    clone.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:10px;height:10px');
    var box;
    try { box = exportVisibleBox(clone); } finally { document.body.removeChild(clone); }
    clone.removeAttribute('style');

    // The key goes in a row of its own under the content, inside the
    // crop margin, and the file grows by that row only when there is one.
    var key = exportKeyGroup(box.x + 32, box.y + box.height - 32 + (EXPORT_KEY_ROW - EXPORT_KEY_SWATCH) / 2);
    if (key) {
      box.height += EXPORT_KEY_ROW;
      clone.appendChild(key);
    }

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);
    clone.setAttribute('width', String(Math.round(box.width)));
    clone.setAttribute('height', String(Math.round(box.height)));
    clone.removeAttribute('id');

    var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = EXPORT_STYLE;
    clone.insertBefore(style, clone.firstChild);

    var ground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ground.setAttribute('x', String(box.x));
    ground.setAttribute('y', String(box.y));
    ground.setAttribute('width', String(box.width));
    ground.setAttribute('height', String(box.height));
    ground.setAttribute('fill', '#ffffff');
    clone.insertBefore(ground, style.nextSibling);

    // Sanitised here, immediately before serialising, rather than earlier:
    // the clone spends a moment in the document to be measured, and
    // anything watching the DOM can write into it in that window. A
    // browser extension injecting a geolocation shim is how this was
    // found -- it rode into the exported file until the order changed.
    exportSanitise(clone);
    var text = new XMLSerializer().serializeToString(clone);
    return {
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n' + text,
      width: box.width,
      height: box.height,
    };
  }

  function exportSave(name, text, mime){
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

  function exportBusy(button, label){
    var was = button.textContent;
    button.textContent = label;
    button.classList.add('is-busy');
    return function(){ button.textContent = was; button.classList.remove('is-busy'); };
  }

  exportSvgBtn.addEventListener('click', function(){
    var done = exportBusy(exportSvgBtn, 'Saving…');
    try {
      exportSave(exportFileName('svg'), exportBuildSvg().text, 'image/svg+xml');
    } finally { done(); }
  });

  // The PNG is the same SVG drawn once into a canvas. Scaled for a retina
  // screen, then clamped: a 40-node map at 2x is about 4,700px wide, and a
  // bigger one must not ask the browser for a canvas it will refuse.
  exportPngBtn.addEventListener('click', function(){
    var done = exportBusy(exportPngBtn, 'Saving…');
    var built;
    try { built = exportBuildSvg(); } catch (err) { done(); return; }
    var scale = EXPORT_PNG_SCALE;
    var longest = Math.max(built.width, built.height) * scale;
    if (longest > EXPORT_PNG_MAX_PX) scale = scale * (EXPORT_PNG_MAX_PX / longest);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(built.width * scale));
    canvas.height = Math.max(1, Math.round(built.height * scale));
    var image = new Image();
    image.onload = function(){
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function(blob){
        if (!blob) { done(); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('download', exportFileName('png'));
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
        done();
      }, 'image/png');
    };
    image.onerror = function(){ done(); };
    // A data: URL rather than a blob: URL, so the image is same-origin and
    // the canvas is never tainted; unescape(encodeURIComponent(...)) keeps
    // btoa correct for non-ASCII labels.
    image.setAttribute('src', 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(built.text))));
  });
`;
}

module.exports = {
  exportBarMarkup,
  exportCss,
  exportScript,
  EXPORT_PNG_SCALE,
  EXPORT_PNG_MAX_PX,
  EXPORT_KEY_SWATCH,
  EXPORT_KEY_ROW,
  EXPORT_KEY_GAP,
};
