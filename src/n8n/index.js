// Public entry point: async renderMap(doc, options) -> HTML string.
// No IO here — see cli.js for the file-system-touching wrapper.

const { validateDoc } = require('./validate');
const { layoutMap } = require('./layout');
const { renderHtml } = require('./render');

async function renderMap(doc, options = {}) {
  // Validate once, then thread the SAME normalised doc through both
  // layoutMap and renderHtml. A raw doc with no `groups` (or other
  // spec-optional fields) is valid per SPEC.md but would otherwise crash
  // renderHtml, which unlike layoutMap never validated its own input.
  const normalized = validateDoc(doc);
  const layout = await layoutMap(normalized, options);
  return renderHtml(layout, normalized);
}

module.exports = { renderMap, layoutMap, renderHtml };
