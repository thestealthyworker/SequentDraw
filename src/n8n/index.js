// Public entry point: async renderMap(doc, opts) -> HTML string.
// No IO here — see cli.js for the file-system-touching wrapper.

const { validateDoc, ValidationError } = require('./validate');
const { layoutMap } = require('./layout');
const { renderHtml } = require('./render');
const { buildDocSvg } = require('./render-doc');
const { LayoutError } = require('./layout-budget');

// `opts.fragment: true` returns the artifact fragment render mode instead of
// a full HTML document -- see render.js's renderHtml() for what that means.
// Omitting `opts` (the default) is unchanged: a full, self-contained page.
async function renderMap(doc, opts = {}) {
  // Validate once, then thread the SAME normalised doc through both
  // layoutMap and renderHtml. A raw doc with no `groups` (or other
  // spec-optional fields) is valid per SPEC.md but would otherwise crash
  // renderHtml, which unlike layoutMap never validated its own input.
  const normalized = validateDoc(doc);
  const layout = await layoutMap(normalized);
  return renderHtml(layout, normalized, opts);
}

// Documentation export: renderSvg(doc, { layers }) -> one standalone SVG
// string. See docs/design/n8n-visual-style.md "Documentation export (SVG
// with inline captions)". Validates the full document first, then filters
// to the chosen layers (`base` always included) — src/n8n/render-doc.js
// does the actual work; this is just the public surface named in the spec.
async function renderSvg(doc, opts = {}) {
  const { svg } = await buildDocSvg(doc, opts);
  return svg;
}

module.exports = { renderMap, renderSvg, layoutMap, renderHtml, validateDoc, ValidationError, LayoutError };
