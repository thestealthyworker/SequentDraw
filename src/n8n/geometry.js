// Generic path-building geometry helpers: none of this is specific to any
// particular product's canvas — bezier curves with horizontal tangents and
// rounded orthogonal polylines are standard flowchart techniques.

function forwardBezierPath(sx, sy, tx, ty) {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 24);
  const c1x = sx + dx;
  const c2x = tx - dx;
  return `M ${sx} ${sy} C ${c1x} ${sy} ${c2x} ${ty} ${tx} ${ty}`;
}

function forwardBezierMidpoint(sx, sy, tx, ty) {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 24);
  const c1x = sx + dx;
  const c2x = tx - dx;
  const t = 0.5;
  const mt = 1 - t;
  const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
  const y = mt * mt * mt * sy + 3 * mt * mt * t * sy + 3 * mt * t * t * ty + t * t * t * ty;
  return [x, y];
}

// Shrinks a corner point toward `towards` by at most `r`, used to round a
// polyline: draw a straight line up to the shrunk point, then a quadratic
// curve (using the true corner as control point) into the next segment.
function shrinkToward(corner, towards, r) {
  const dx = towards[0] - corner[0];
  const dy = towards[1] - corner[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(r, len / 2) / len;
  return [corner[0] + dx * t, corner[1] + dy * t];
}

function roundedOrthogonalPath(points, radius) {
  if (points.length < 2) return '';
  const d = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const a = shrinkToward(cur, prev, radius);
    const b = shrinkToward(cur, next, radius);
    d.push(`L ${a[0]} ${a[1]}`);
    d.push(`Q ${cur[0]} ${cur[1]} ${b[0]} ${b[1]}`);
  }
  const last = points[points.length - 1];
  d.push(`L ${last[0]} ${last[1]}`);
  return d.join(' ');
}

// Backward (target left of source) detour: right off the source, down to
// sourceY+drop, across, then a stub into the target from the left.
function backwardDetourPoints(sx, sy, tx, ty, stub, drop) {
  const midY = sy + drop;
  return [
    [sx, sy],
    [sx + stub, sy],
    [sx + stub, midY],
    [tx - stub, midY],
    [tx - stub, ty],
    [tx, ty],
  ];
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

function polylineMidpoint(points) {
  const total = polylineLength(points);
  const half = total / 2;
  let covered = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (covered + seg >= half || i === points.length - 1) {
      const remain = half - covered;
      const t = seg === 0 ? 0 : remain / seg;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    covered += seg;
  }
  return points[points.length - 1];
}

// A rounded-rect path with an independent radius per corner, so entry nodes
// can render their "D" shape (left corners wide, right corners default).
function roundedRectPath(x, y, w, h, rTopLeft, rTopRight, rBottomRight, rBottomLeft) {
  return [
    `M ${x + rTopLeft} ${y}`,
    `L ${x + w - rTopRight} ${y}`,
    rTopRight ? `A ${rTopRight} ${rTopRight} 0 0 1 ${x + w} ${y + rTopRight}` : '',
    `L ${x + w} ${y + h - rBottomRight}`,
    rBottomRight ? `A ${rBottomRight} ${rBottomRight} 0 0 1 ${x + w - rBottomRight} ${y + h}` : '',
    `L ${x + rBottomLeft} ${y + h}`,
    rBottomLeft ? `A ${rBottomLeft} ${rBottomLeft} 0 0 1 ${x} ${y + h - rBottomLeft}` : '',
    `L ${x} ${y + rTopLeft}`,
    rTopLeft ? `A ${rTopLeft} ${rTopLeft} 0 0 1 ${x + rTopLeft} ${y}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

// Rough greedy word-wrap for the label, since no real font metrics are
// available outside a browser. avgChar is an approximate glyph width in px.
function wrapLabel(text, maxWidth, maxLines, fontSize) {
  const avgChar = fontSize * 0.56;
  const maxChars = Math.max(4, Math.floor(maxWidth / avgChar));
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines) {
    const remainingWords = words.slice(words.join(' ').length >= text.trim().length ? words.length : 0);
    const consumed = lines.join(' ').length;
    if (consumed < text.trim().length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && (last.length + 1) > maxChars) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/\s+\S*$/, '') + '…';
    }
  }
  return lines.slice(0, maxLines);
}

function truncateLine(text, maxWidth, fontSize) {
  const avgChar = fontSize * 0.52;
  const maxChars = Math.max(4, Math.floor(maxWidth / avgChar));
  const s = String(text);
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…';
}

module.exports = {
  forwardBezierPath,
  forwardBezierMidpoint,
  roundedOrthogonalPath,
  backwardDetourPoints,
  polylineMidpoint,
  roundedRectPath,
  wrapLabel,
  truncateLine,
};
