// Measures both layout strategies against the Medusa fixture and prints a
// comparison table, per the brief: canvas size/aspect ratio, edge segments
// crossing a frame they don't belong to, backward-edge count, overlapping
// label-box pairs, and edges crossing a node box they don't belong to.

const path = require('path');
const fs = require('fs');
const { layoutMap } = require('../src/n8n/layout');
const { LABEL_RESERVE } = require('../src/n8n/constants');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Minimal sampler for the two path grammars this renderer emits: a single
// cubic bezier ("M x y C c1x c1y c2x c2y x y") or an M + repeated (L, Q)
// rounded-orthogonal polyline.
function samplePath(d, stepsPerSeg = 12) {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g);
  const pts = [];
  let i = 0;
  let cur = null;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      if (cmd === 'M') pts.push([x, y]);
      else {
        for (let s = 1; s <= stepsPerSeg; s++) {
          const t = s / stepsPerSeg;
          pts.push([cur[0] + (x - cur[0]) * t, cur[1] + (y - cur[1]) * t]);
        }
      }
      cur = [x, y];
    } else if (cmd === 'Q') {
      const cx = Number(tokens[i++]);
      const cy = Number(tokens[i++]);
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      for (let s = 1; s <= stepsPerSeg; s++) {
        const t = s / stepsPerSeg;
        const mt = 1 - t;
        const px = mt * mt * cur[0] + 2 * mt * t * cx + t * t * x;
        const py = mt * mt * cur[1] + 2 * mt * t * cy + t * t * y;
        pts.push([px, py]);
      }
      cur = [x, y];
    } else if (cmd === 'C') {
      const c1x = Number(tokens[i++]);
      const c1y = Number(tokens[i++]);
      const c2x = Number(tokens[i++]);
      const c2y = Number(tokens[i++]);
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      for (let s = 1; s <= stepsPerSeg; s++) {
        const t = s / stepsPerSeg;
        const mt = 1 - t;
        const px = mt * mt * mt * cur[0] + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x;
        const py = mt * mt * mt * cur[1] + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y;
        pts.push([px, py]);
      }
      cur = [x, y];
    } else if (cmd === 'Z') {
      // no-op for these path grammars
    }
  }
  return pts;
}

function pointInRect(pt, rect, eps = 0.01) {
  return pt[0] > rect.x + eps && pt[0] < rect.x + rect.w - eps && pt[1] > rect.y + eps && pt[1] < rect.y + rect.h - eps;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

async function measure(strategy) {
  const layout = await layoutMap(doc, { strategy });
  const byId = {};
  doc.nodes.forEach(n => (byId[n.id] = n));

  const aspect = layout.canvas.width / layout.canvas.height;
  const backwardCount = layout.edges.filter(e => !e.forward).length;

  // Overlapping label-box pairs.
  const labelBoxes = Object.entries(layout.nodeBoxes).map(([id, b]) => ({
    id,
    x: b.x,
    y: b.y + b.h,
    w: b.w,
    h: LABEL_RESERVE,
  }));
  let labelOverlaps = 0;
  for (let i = 0; i < labelBoxes.length; i++) {
    for (let j = i + 1; j < labelBoxes.length; j++) {
      if (overlaps(labelBoxes[i], labelBoxes[j])) labelOverlaps++;
    }
  }

  // Edge segments crossing a frame the edge neither starts nor ends in.
  let frameViolations = 0;
  const sampled = layout.edges.map(e => ({ e, pts: samplePath(e.d) }));
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

  return {
    strategy,
    width: Math.round(layout.canvas.width),
    height: Math.round(layout.canvas.height),
    aspect: aspect.toFixed(2),
    frameViolations,
    backwardCount,
    labelOverlaps,
    nodeViolations,
  };
}

(async () => {
  const rows = [];
  for (const strategy of ['flat', 'rows']) {
    rows.push(await measure(strategy));
  }
  const columns = [
    ['strategy', 'strategy'],
    ['width', 'width'],
    ['height', 'height'],
    ['aspect', 'aspect'],
    ['frame-crossings', 'frameViolations'],
    ['backward-edges', 'backwardCount'],
    ['label-overlaps', 'labelOverlaps'],
    ['node-crossings', 'nodeViolations'],
  ];
  const table = [columns.map(c => c[0]), ...rows.map(r => columns.map(c => String(r[c[1]])))];
  const widths = columns.map((c, i) => Math.max(c[0].length, ...table.slice(1).map(r => r[i].length)));
  table.forEach(r => console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ')));
})();
