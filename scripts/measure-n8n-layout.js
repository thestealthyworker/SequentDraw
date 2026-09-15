// Measures the flat layout strategy against the Medusa fixture and prints a
// row of stats, per the brief: canvas size/aspect ratio, edge segments
// crossing a frame they don't belong to, edge segments crossing label text
// (node label/sublabel or frame title), backward-edge count, overlapping
// label-box pairs, edges crossing a node box they don't belong to, note
// boxes overlapping anything they shouldn't (node, label, frame title,
// another note), and edges crossing a note box.

const path = require('path');
const fs = require('fs');
const { layoutMap } = require('../src/n8n/layout');
const { validateDoc } = require('../src/n8n/validate');
const { filterDocForLayers } = require('../src/n8n/doc-filter');
const { captionReserveExtra } = require('../src/n8n/captions');
const { layoutValidated } = require('../src/n8n/layout');
const { placeEdgeTexts } = require('../src/n8n/edge-text');
const { labelBoxesOf, frameTitleBoxesOf } = require('../src/n8n/obstacles');
const { samplePath, pointInRect } = require('../src/n8n/sample-path');
const { LABEL_RESERVE } = require('../src/n8n/constants');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Shared by both the interactive-layout measure() below and the
// --svg mode measureDoc(): everything that doesn't depend on which
// layout pass (interactive LABEL_RESERVE vs. the doc-export's grown
// labelReserve) produced `layout`/`labelBoxes`.
function baseMetrics(layout, labelBoxes, edgeTextBoxes, groups) {
  const byId = {};
  doc.nodes.forEach(n => (byId[n.id] = n));

  const aspect = layout.canvas.width / layout.canvas.height;
  const backwardCount = layout.edges.filter(e => !e.forward).length;

  // Overlapping label-box pairs (interactive: label+sublabel strip only;
  // doc-export: the same strip grown to also cover caption text — see
  // obstacles.js nodeLabelBox).
  let labelOverlaps = 0;
  for (let i = 0; i < labelBoxes.length; i++) {
    for (let j = i + 1; j < labelBoxes.length; j++) {
      if (overlaps(labelBoxes[i], labelBoxes[j])) labelOverlaps++;
    }
  }

  const sampled = layout.edges.map(e => ({ e, pts: samplePath(e.d) }));

  // Edge segments crossing a frame the edge neither starts nor ends in.
  let frameViolations = 0;
  for (const { e, pts } of sampled) {
    const ownGroups = new Set([byId[e.from].parentId, byId[e.to].parentId].filter(Boolean));
    for (const [groupId, frame] of Object.entries(layout.frameBoxes)) {
      if (ownGroups.has(groupId)) continue;
      if (pts.some(pt => pointInRect(pt, frame))) frameViolations++;
    }
  }

  // Edges crossing a node box they don't belong to.
  let nodeViolations = 0;
  for (const { e, pts } of sampled) {
    for (const [nodeId, box] of Object.entries(layout.nodeBoxes)) {
      if (nodeId === e.from || nodeId === e.to) continue;
      if (pts.some(pt => pointInRect(pt, box))) nodeViolations++;
    }
  }

  // Edges crossing label text: any node's label/sublabel box (endpoints
  // included — an edge is not allowed to cut across its own label any more
  // than someone else's) or any frame's title box. In --svg mode
  // `labelBoxes` already covers caption text too (see obstacles.js
  // nodeLabelBox / doc-layout's grown labelReserve), so this also reports
  // "edge-label crossings (including captions)" per the spec.
  const frameTitleBoxes = frameTitleBoxesOf(groups || doc.groups, layout.frameBoxes);
  const allTextBoxes = labelBoxes.concat(frameTitleBoxes);
  let edgeLabelCrossings = 0;
  for (const { pts } of sampled) {
    for (const box of allTextBoxes) {
      if (pts.some(pt => pointInRect(pt, box))) edgeLabelCrossings++;
    }
  }

  // Note overlaps: a note box overlapping a node, a node's label strip, a
  // frame title, or another note — any of these is a placement bug per
  // docs/design/n8n-visual-style.md "Placement" (a frame's empty BODY is
  // the one thing an attached note may legitimately sit over, so frame
  // bodies are not counted here).
  const noteEntries = Object.entries(layout.noteBoxes || {}).map(([id, b]) => ({ id, ...b }));
  let noteOverlaps = 0;
  for (const note of noteEntries) {
    for (const [nodeId, box] of Object.entries(layout.nodeBoxes)) {
      if (overlaps(note, box)) noteOverlaps++;
    }
    for (const lb of labelBoxes) {
      if (overlaps(note, lb)) noteOverlaps++;
    }
    for (const tb of frameTitleBoxes) {
      if (overlaps(note, tb)) noteOverlaps++;
    }
  }
  for (let i = 0; i < noteEntries.length; i++) {
    for (let j = i + 1; j < noteEntries.length; j++) {
      if (overlaps(noteEntries[i], noteEntries[j])) noteOverlaps++;
    }
  }

  // Edge segments crossing a note box — notes are obstacles for routing,
  // never exempt (see layout.js computeEdges).
  let edgeNoteCrossings = 0;
  for (const { pts } of sampled) {
    for (const note of noteEntries) {
      if (pts.some(pt => pointInRect(pt, note))) edgeNoteCrossings++;
    }
  }

  // Edge-text-label overlaps (--svg mode only; empty otherwise): each
  // PLACED edge-text box (edge-text.js already only places one when it
  // clears everything at placement time — this independently re-checks it
  // against nodes, labels/captions, frame titles, notes and every other
  // placed edge-text box, per "measured, not trusted").
  const textBoxes = edgeTextBoxes || [];
  let edgeTextLabelOverlaps = 0;
  for (const tb of textBoxes) {
    for (const [, box] of Object.entries(layout.nodeBoxes)) {
      if (overlaps(tb, box)) edgeTextLabelOverlaps++;
    }
    for (const lb of labelBoxes) {
      if (overlaps(tb, lb)) edgeTextLabelOverlaps++;
    }
    for (const ftb of frameTitleBoxes) {
      if (overlaps(tb, ftb)) edgeTextLabelOverlaps++;
    }
    for (const note of noteEntries) {
      if (overlaps(tb, note)) edgeTextLabelOverlaps++;
    }
  }
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      if (overlaps(textBoxes[i], textBoxes[j])) edgeTextLabelOverlaps++;
    }
  }

  return {
    width: Math.round(layout.canvas.width),
    height: Math.round(layout.canvas.height),
    aspect: aspect.toFixed(2),
    frameViolations,
    edgeLabelCrossings,
    backwardCount,
    labelOverlaps,
    nodeViolations,
    noteOverlaps,
    edgeNoteCrossings,
    edgeTextLabelOverlaps,
  };
}

// Interactive layout (the existing default mode): LABEL_RESERVE as-is, no
// edge-text labels.
async function measure() {
  const layout = await layoutMap(doc);
  const labelBoxes = labelBoxesOf(layout.nodeBoxes);
  return baseMetrics(layout, labelBoxes, [], doc.groups);
}

// Documentation-export layout (--svg mode): filter to `layers` (base
// always included), grow the label reserve to fit the tallest caption in
// play (same computation buildDocSvg uses — see render-doc.js), and place
// edge-text labels the same way the SVG renderer does, so this measures
// exactly what the exported figure will contain.
async function measureDoc(layers) {
  const validated = validateDoc(doc);
  const filtered = filterDocForLayers(validated, layers);
  const labelReserve = LABEL_RESERVE + captionReserveExtra(filtered.nodes);
  const layout = await layoutValidated(filtered, { labelReserve });
  const labelBoxes = labelBoxesOf(layout.nodeBoxes, labelReserve);
  const frameTitleBoxes = frameTitleBoxesOf(filtered.groups, layout.frameBoxes);
  const noteBoxList = Object.entries(layout.noteBoxes).map(([id, b]) => ({ id, ...b }));
  const nodeBoxList = Object.values(layout.nodeBoxes);
  const edgeText = placeEdgeTexts(filtered, layout.edges, {
    nodeBoxes: nodeBoxList,
    labelBoxes,
    frameTitleBoxes,
    noteBoxes: noteBoxList,
  });
  const edgeTextBoxes = edgeText.labels.map(l => l.box);
  const row = baseMetrics(layout, labelBoxes, edgeTextBoxes, filtered.groups);
  return { ...row, edgeTextPlaced: edgeText.placedCount, edgeTextOmitted: edgeText.omittedCount };
}

function printTable(row, columns) {
  const table = [columns.map(c => c[0]), columns.map(c => String(row[c[1]]))];
  const widths = columns.map((c, i) => Math.max(c[0].length, ...table.map(r => r[i].length)));
  table.forEach(r => console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ')));
}

const BASE_COLUMNS = [
  ['width', 'width'],
  ['height', 'height'],
  ['aspect', 'aspect'],
  ['frame-crossings', 'frameViolations'],
  ['edge-label-crossings', 'edgeLabelCrossings'],
  ['backward-edges', 'backwardCount'],
  ['label-overlaps', 'labelOverlaps'],
  ['node-crossings', 'nodeViolations'],
  ['note-overlaps', 'noteOverlaps'],
  ['edge-note-crossings', 'edgeNoteCrossings'],
];
const SVG_COLUMNS = BASE_COLUMNS.concat([
  ['edge-text-overlaps', 'edgeTextLabelOverlaps'],
  ['edge-text-placed', 'edgeTextPlaced'],
  ['edge-text-omitted', 'edgeTextOmitted'],
]);

module.exports = { measure, measureDoc };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const svgIdx = args.indexOf('--svg');
    if (svgIdx === -1) {
      printTable(await measure(), BASE_COLUMNS);
    } else {
      const layersArg = args[svgIdx + 1];
      const layers = layersArg && !layersArg.startsWith('-') ? layersArg.split(',').map(s => s.trim()).filter(Boolean) : [];
      printTable(await measureDoc(layers), SVG_COLUMNS);
    }
  })();
}
