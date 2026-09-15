// Sticky-note sizing and placement. Runs after node boxes and frame boxes
// are final but BEFORE edges are routed — notes are obstacles for routing
// too (see docs/design/n8n-visual-style.md "Notes (text boxes)" and
// "Placement"), so their boxes must exist first.

const {
  snap,
  GRID,
  LABEL_RESERVE,
  NOTE_MIN_WIDTH,
  NOTE_MAX_WIDTH,
  NOTE_PAD_X,
  NOTE_PAD_Y,
  NOTE_GAP,
} = require('./constants');
const { layoutMarkdown } = require('./markdown');
const { frameTitleBoxesOf } = require('./obstacles');

// Width grows with content length so a short note stays compact and a long
// one doesn't force excessive wrapping; all tiers are already 16px-grid
// multiples. This is a heuristic, not a measurement — actual height always
// comes from layoutMarkdown against the chosen width.
function pickWidth(content) {
  const len = String(content).length;
  if (len <= 90) return NOTE_MIN_WIDTH;
  if (len <= 200) return 320;
  if (len <= 380) return 400;
  return NOTE_MAX_WIDTH;
}

function sizeNote(content) {
  const width = pickWidth(content);
  const innerWidth = width - NOTE_PAD_X * 2;
  const mdLayout = layoutMarkdown(content, innerWidth);
  // Round the height up generously (8px) rather than trusting the estimate
  // to the pixel — a cheap extra safety margin against overflow.
  const height = Math.ceil((mdLayout.height + NOTE_PAD_Y * 2) / 8) * 8;
  return { width, height, mdLayout };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function nodeFootprint(box) {
  return { x: box.x, y: box.y, w: box.w, h: box.h + LABEL_RESERVE };
}

function contentBBox(nodeBoxes, frameBoxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  Object.values(nodeBoxes).forEach(b => {
    const fp = nodeFootprint(b);
    minX = Math.min(minX, fp.x);
    minY = Math.min(minY, fp.y);
    maxX = Math.max(maxX, fp.x + fp.w);
    maxY = Math.max(maxY, fp.y + fp.h);
  });
  Object.values(frameBoxes).forEach(f => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Bounding box of a note's attached nodes/groups, including a node's
// reserved label strip (per spec: "beside the bounding box of its attached
// nodes/groups (including their label strips)").
function attachTargetBox(attachTo, nodeBoxes, frameBoxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  attachTo.forEach(id => {
    if (nodeBoxes[id]) {
      const fp = nodeFootprint(nodeBoxes[id]);
      minX = Math.min(minX, fp.x);
      minY = Math.min(minY, fp.y);
      maxX = Math.max(maxX, fp.x + fp.w);
      maxY = Math.max(maxY, fp.y + fp.h);
    } else if (frameBoxes[id]) {
      const f = frameBoxes[id];
      minX = Math.min(minX, f.x);
      minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.w);
      maxY = Math.max(maxY, f.y + f.h);
    }
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function boxForDirection(target, w, h, dir, offset) {
  if (dir === 'above') return { x: snap(target.x), y: snap(target.y - NOTE_GAP - offset - h), w, h };
  if (dir === 'right') return { x: snap(target.x + target.w + NOTE_GAP + offset), y: snap(target.y), w, h };
  if (dir === 'below') return { x: snap(target.x), y: snap(target.y + target.h + NOTE_GAP + offset), w, h };
  return { x: snap(target.x - NOTE_GAP - offset - w), y: snap(target.y), w, h }; // left
}

// note or map-level boxes -> { [noteId]: { x, y, w, h, color, mdLayout } }.
function computeNoteBoxes(doc, nodeBoxes, frameBoxes) {
  const notes = Array.isArray(doc.notes) ? doc.notes : [];
  if (!notes.length) return {};

  const nodeFootprints = Object.values(nodeBoxes).map(nodeFootprint);
  const frameTitleBoxes = frameTitleBoxesOf(doc.groups, frameBoxes);
  const frameEntries = Object.entries(frameBoxes).map(([id, f]) => ({ id, ...f }));
  const placed = []; // every note box placed so far this pass, always an obstacle for the next one

  // attachToSet is null for a map-level note (no frame carve-out applies).
  // For an attached note, the frame BODY of a frame it names is exempt,
  // but never that frame's title box — frameTitleBoxes is checked
  // unconditionally above, with no such exemption.
  function isClear(box, attachToSet) {
    if (nodeFootprints.some(n => overlaps(box, n))) return false;
    if (frameTitleBoxes.some(t => overlaps(box, t))) return false;
    for (const f of frameEntries) {
      if (attachToSet && attachToSet.has(f.id)) continue;
      if (overlaps(box, f)) return false;
    }
    if (placed.some(p => overlaps(box, p))) return false;
    return true;
  }

  const result = {};
  const bbox = contentBBox(nodeBoxes, frameBoxes);
  let topY = bbox.y; // successive map-level notes stack further up

  notes.forEach(note => {
    const attachTo = Array.isArray(note.attachTo) ? note.attachTo : [];
    const { width, height, mdLayout } = sizeNote(note.content);
    let box;

    if (!attachTo.length) {
      // Map-level: top-left of the canvas, above/left of everything.
      box = { x: snap(bbox.x), y: snap(topY - NOTE_GAP - height), w: width, h: height };
      let guard = 0;
      while (!isClear(box, null) && guard < 200) {
        box = { ...box, y: box.y - GRID };
        guard++;
      }
      topY = box.y;
    } else {
      const attachToSet = new Set(attachTo);
      const target = attachTargetBox(attachTo, nodeBoxes, frameBoxes);
      const dirs = ['above', 'right', 'below', 'left'];
      box = null;
      for (const dir of dirs) {
        const candidate = boxForDirection(target, width, height, dir, 0);
        if (isClear(candidate, attachToSet)) {
          box = candidate;
          break;
        }
      }
      if (!box) {
        // No base candidate was clear: push outward in 16px steps along
        // the most-preferred side (above) until one is.
        for (let offset = GRID; offset <= 4000; offset += GRID) {
          const candidate = boxForDirection(target, width, height, 'above', offset);
          if (isClear(candidate, attachToSet)) {
            box = candidate;
            break;
          }
        }
      }
      if (!box) box = boxForDirection(target, width, height, 'above', 4000);
    }

    result[note.id] = { x: box.x, y: box.y, w: box.w, h: box.h, color: note.color || 'yellow', mdLayout };
    placed.push(box);
  });

  return result;
}

module.exports = { computeNoteBoxes, sizeNote, pickWidth };
