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

// Six-point orthogonal detour shared by the backward-edge route and by the
// forward obstacle-avoidance route in routing.js: a stub rightward out of
// the source's output handle, travel to a shared "cruise" y level clear of
// whatever it needs to avoid, cross to above/below the target, then a stub
// rightward into the target's input handle. The source always exits right
// and the target is always entered from the left regardless of which side
// is geometrically further right — that's just how the handles are
// oriented — so no sign flip is needed between the forward and backward
// cases, only a clamp for when the endpoints are close together.
function clampStub(sx, tx, stub) {
  return Math.max(4, Math.min(stub, Math.abs(tx - sx) / 2 || stub));
}

function detourPoints(sx, sy, tx, ty, stub, cruiseY) {
  const s = clampStub(sx, tx, stub);
  return detourPointsAtX(sx, sy, tx, ty, sx + s, tx - s, cruiseY);
}

// Same shape as detourPoints, but with the drop/approach x positions given
// explicitly rather than derived from a fixed stub length — used when the
// stub's default position would land the vertical connector inside a frame
// it doesn't belong to (see routing.js chooseClearDropX).
function detourPointsAtX(sx, sy, tx, ty, dropX, approachX, cruiseY) {
  return [
    [sx, sy],
    [dropX, sy],
    [dropX, cruiseY],
    [approachX, cruiseY],
    [approachX, ty],
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

// Greedy word wrap for a BLOCK of plain text — node captions and edge
// labels in the documentation export. Unlike wrapLabel, which exists to
// squeeze a short label into a fixed two-line slot and throws away
// whatever is left, this wraps to as many lines as the text actually
// needs and only ellipsises past `maxLines`.
//
// The difference matters because of what the documentation export is for:
// a slide, PDF or screenshot where nobody can hover. A caption cut
// mid-sentence ("Owns shipment state, including the…") tells the reader
// less than the node label already did, so truncation defeats the figure's
// only job. `maxLines` is therefore a safety ceiling against absurd input,
// not a design target — it is set high enough that no schema-legal
// description reaches it.
//
// A single word longer than the line budget is hard-broken rather than
// left to overflow its column: a 280-character description with no spaces
// is legal input (SPEC.md caps the field, not its word lengths) and still
// has to fit inside the box that was reserved for it.
function wrapParagraph(text, maxWidth, maxLines, fontSize) {
  const avgChar = fontSize * 0.56;
  const maxChars = Math.max(4, Math.floor(maxWidth / avgChar));
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  const flush = () => {
    if (cur) {
      lines.push(cur);
      cur = '';
    }
  };
  for (const word of words) {
    let rest = word;
    while (rest.length > maxChars) {
      flush();
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (!rest) continue;
    const next = cur ? `${cur} ${rest}` : rest;
    if (next.length > maxChars && cur) {
      flush();
      cur = rest;
    } else {
      cur = next;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last) + '…';
  return kept;
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
  clampStub,
  detourPoints,
  detourPointsAtX,
  polylineMidpoint,
  roundedRectPath,
  wrapLabel,
  wrapParagraph,
  truncateLine,
};
