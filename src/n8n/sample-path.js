// Minimal point sampler for the two SVG path grammars this renderer emits:
// a single cubic bezier ("M x y C c1x c1y c2x c2y x y") or an M + repeated
// (L, Q) rounded-orthogonal polyline (see geometry.js). Shared by the
// measurement script and the layout tests so "does this edge's rendered
// path cross box X" is checked the same way in both places.

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

module.exports = { samplePath, pointInRect };
