// Public entry point: async renderMap(doc, options) -> HTML string.
// No IO here — see cli.js for the file-system-touching wrapper.

const { layoutMap } = require('./layout');
const { renderHtml } = require('./render');

async function renderMap(doc, options = {}) {
  const layout = await layoutMap(doc, options);
  return renderHtml(layout, doc);
}

module.exports = { renderMap, layoutMap, renderHtml };
