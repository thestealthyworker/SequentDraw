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

function noteMarkup(note, box) {
  const palette = NOTE_COLORS[box.color] || NOTE_COLORS.yellow;

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
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${NOTE_RADIUS}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="${NOTE_BORDER_WIDTH}" vector-effect="non-scaling-stroke"/>
<text class="note-text">${tspans.join('')}</text>
</g>`;
}

module.exports = { noteMarkup };
