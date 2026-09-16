// SVG markup for sticky notes. Renders the exact `lines` array that
// notes.js/markdown.js already used to size the box, so there is no
// separate "estimate vs render" pass to disagree and overflow the box.
//
// IMPORTANT: run.text and run.href are already HTML-escaped by
// markdown.js (escaped once, up front, before markdown syntax is
// recognised) — do NOT pass them through esc() again here, or entities
// double-escape and show up literally (e.g. "&amp;") in the note.

const { esc, layersOf } = require('./render-svg');
const {
  NOTE_COLORS,
  NOTE_PAD_X,
  NOTE_PAD_Y,
  NOTE_RADIUS,
  NOTE_BORDER_WIDTH,
  NOTE_BLANK_GAP,
} = require('./constants');
const { metricsFor } = require('./markdown');

function runMarkup(run) {
  const cls = [run.bold && 'note-bold', run.italic && 'note-italic', run.code && 'note-code'].filter(Boolean).join(' ');
  // run.text is already escaped (see module header) — inserted as-is.
  const inner = `<tspan${cls ? ` class="${cls}"` : ''}>${run.text}</tspan>`;
  if (run.href) {
    // run.href is already escaped too, safe to place directly in the
    // attribute; validated by markdown.js to be http(s)/mailto only.
    return `<a href="${run.href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  return inner;
}

function lineMarkup(line, box, y) {
  if (line.kind === 'blank') return '';
  const kindClass = line.kind === 'h1' ? ' note-h1' : line.kind === 'h2' ? ' note-h2' : '';
  const textX = box.x + NOTE_PAD_X + line.indent;
  const parts = [];
  if (line.bulletMarker) {
    parts.push(`<tspan x="${box.x + NOTE_PAD_X}" y="${y}">•</tspan>`);
  }
  const runs = line.runs.map(runMarkup).join('');
  parts.push(`<tspan x="${textX}" y="${y}"${kindClass ? ` class="${kindClass.trim()}"` : ''}>${runs}</tspan>`);
  return parts.join('');
}

// A connector to a target the note could not be placed beside (see
// notes.js). `data-target` names that node or group so the viewer can hide
// this one line when its target is hidden by a layer toggle, leaving no
// dangling leftover; the connector as a whole lives inside the note's own
// <g>, so it also disappears with the note.
function connectorMarkup(connector, palette) {
  return `<line class="note-link" data-target="${esc(connector.target)}" x1="${connector.x1}" y1="${connector.y1}" x2="${connector.x2}" y2="${connector.y2}" stroke="${palette.border}" stroke-width="1" stroke-dasharray="4 4" opacity="0.8" vector-effect="non-scaling-stroke"/>`;
}

function noteMarkup(note, box) {
  const palette = NOTE_COLORS[box.color] || NOTE_COLORS.yellow;
  const connectors = (box.connectors || []).map(c => connectorMarkup(c, palette)).join('');

  let y = box.y + NOTE_PAD_Y;
  const tspans = [];
  box.mdLayout.lines.forEach(line => {
    if (line.kind === 'blank') {
      y += NOTE_BLANK_GAP;
      return;
    }
    const { fontSize, lineHeight } = metricsFor(line.kind);
    y += fontSize; // top-of-line -> baseline, approximated by the font's ascent
    tspans.push(lineMarkup(line, box, y));
    y += lineHeight - fontSize;
  });

  return `<g class="n8n-note" data-id="${esc(note.id)}" data-layers="${esc(layersOf(note).join(' '))}">
${connectors}
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${NOTE_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="${NOTE_BORDER_WIDTH}" vector-effect="non-scaling-stroke"/>
<text class="note-text">${tspans.join('')}</text>
</g>`;
}

module.exports = { noteMarkup };
