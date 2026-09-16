// CTO-M1-04 regression: a sticky note has to sit next to the thing it
// annotates. docs/design/n8n-visual-style.md states the rule — a note is
// "placed beside the bounding box of the nodes it names" — but before the
// fix the Medusa map put n_consider_silent_notification 1192-1368px from
// both of its targets, directly above an unrelated frame, where a reader
// attributes it to Payment rather than Notifications.
//
// The rule asserted here is the CTO's: every attached note sits within one
// node-spacing (128px) of each thing it names, OR is visibly connected to
// it. One Medusa note genuinely cannot satisfy the first half — the layout
// puts its two targets 1,100px apart — so the connector is not a loophole,
// it is the other half of the rule, and these tests check the connector is
// real geometry that touches both ends rather than decoration.
//
// Distances are computed here from the layout output with this file's own
// box-gap helper, deliberately NOT by importing the renderer's, so the
// measurement is independent of the code it judges.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { layoutMap } = require('../src/n8n/layout');
const { renderMap } = require('../src/n8n/index');
const { buildDocSvg } = require('../src/n8n/render-doc');
const { LABEL_RESERVE, NOTE_ATTACH_MAX_GAP } = require('../src/n8n/constants');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const medusaDoc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Shortest distance between two axis-aligned boxes; 0 when they touch.
function boxGap(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

// What a reader sees for one attach target: a node's shape plus the label
// strip reserved under it, or a group's whole frame.
function targetBoxFor(id, layout, labelReserve) {
  const node = layout.nodeBoxes[id];
  if (node) return { x: node.x, y: node.y, w: node.w, h: node.h + labelReserve };
  const frame = layout.frameBoxes[id];
  if (frame) return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  return null;
}

function pointInBox(p, box, tolerance) {
  return (
    p.x >= box.x - tolerance &&
    p.x <= box.x + box.w + tolerance &&
    p.y >= box.y - tolerance &&
    p.y <= box.y + box.h + tolerance
  );
}

// Every (note, target) pair that is BOTH further than the limit AND has no
// connector — the actual defect, in either output.
function orphanedPairs(doc, layout, labelReserve) {
  const bad = [];
  doc.notes.forEach(note => {
    const attachTo = Array.isArray(note.attachTo) ? note.attachTo : [];
    if (!attachTo.length) return; // map-level: names nothing, nothing to sit beside
    const noteBox = layout.noteBoxes[note.id];
    assert.ok(noteBox, `note ${note.id} was not placed`);
    const connected = new Set((noteBox.connectors || []).map(c => c.target));
    attachTo.forEach(id => {
      const target = targetBoxFor(id, layout, labelReserve);
      if (!target) return; // target filtered out of this layer set
      const gap = boxGap(noteBox, target);
      if (gap > NOTE_ATTACH_MAX_GAP && !connected.has(id)) {
        bad.push(`${note.id} is ${Math.round(gap)}px from ${id} with no connector`);
      }
    });
  });
  return bad;
}

describe('CTO-M1-04: attached notes sit beside what they name (interactive map)', () => {
  let layout;

  test('layout resolves and places every note', async () => {
    layout = await layoutMap(medusaDoc);
    assert.strictEqual(Object.keys(layout.noteBoxes).length, medusaDoc.notes.length);
  });

  test('every attached note is within 128px of each target, or connected to it', () => {
    assert.deepStrictEqual(orphanedPairs(medusaDoc, layout, LABEL_RESERVE), []);
  });

  test('the notes the CTO measured are now beside their targets', () => {
    // n_consider_silent_notification was 1192-1368px from both targets and
    // n_refund_cap 240px from its single one. Each must now reach at least
    // one target directly — a note attached to a single node has no excuse
    // for a connector at all.
    const singleTarget = medusaDoc.notes.filter(n => (n.attachTo || []).length === 1);
    assert.ok(singleTarget.length >= 3, 'fixture should still carry single-target notes');
    singleTarget.forEach(note => {
      const box = layout.noteBoxes[note.id];
      const target = targetBoxFor(note.attachTo[0], layout, LABEL_RESERVE);
      const gap = boxGap(box, target);
      assert.ok(gap <= NOTE_ATTACH_MAX_GAP, `${note.id} is ${Math.round(gap)}px from ${note.attachTo[0]}`);
      assert.deepStrictEqual(box.connectors, [], `${note.id} should not need a connector`);
    });
  });

  test('a connector is real geometry: it touches both the note and its target', () => {
    let checked = 0;
    Object.entries(layout.noteBoxes).forEach(([noteId, box]) => {
      (box.connectors || []).forEach(connector => {
        const target = targetBoxFor(connector.target, layout, LABEL_RESERVE);
        assert.ok(target, `${noteId} connects to unknown target ${connector.target}`);
        assert.ok(
          pointInBox({ x: connector.x1, y: connector.y1 }, box, 1),
          `${noteId}: connector does not start on the note`,
        );
        assert.ok(
          pointInBox({ x: connector.x2, y: connector.y2 }, target, 1),
          `${noteId}: connector does not end on ${connector.target}`,
        );
        checked++;
      });
    });
    assert.ok(checked > 0, 'the Medusa fixture should exercise at least one connector');
  });

  test('a connector is only drawn where the note could not reach its target', () => {
    Object.entries(layout.noteBoxes).forEach(([noteId, box]) => {
      (box.connectors || []).forEach(connector => {
        const target = targetBoxFor(connector.target, layout, LABEL_RESERVE);
        const gap = boxGap(box, target);
        assert.ok(gap > NOTE_ATTACH_MAX_GAP, `${noteId}: connector to ${connector.target} at only ${Math.round(gap)}px`);
      });
    });
  });

  test('placement stays deterministic across runs, connectors included', async () => {
    const a = await layoutMap(medusaDoc);
    const b = await layoutMap(medusaDoc);
    const shape = l =>
      Object.fromEntries(
        Object.entries(l.noteBoxes).map(([id, box]) => [id, { x: box.x, y: box.y, connectors: box.connectors }]),
      );
    assert.deepStrictEqual(shape(a), shape(b));
  });
});

describe('CTO-M1-04: the same holds in the static documentation export', () => {
  const layerSets = [[], ['business'], ['edge'], ['business', 'edge', 'build']];

  layerSets.forEach(layers => {
    test(`layers=${JSON.stringify(layers)}: no note is stranded from what it names`, async () => {
      const { layout, labelReserve } = await buildDocSvg(medusaDoc, { layers });
      // Notes surviving the layer filter, with their filtered attachTo.
      const doc = { notes: Object.keys(layout.noteBoxes).map(id => medusaDoc.notes.find(n => n.id === id)) };
      assert.deepStrictEqual(orphanedPairs(doc, layout, labelReserve), []);
    });
  });
});

// ---------------------------------------------------------------------
// CTO-M1-05: the connector CTO-M1-04 introduced must not mis-attribute
// the note all over again. On main@aee7b42 the Medusa map drew
// n_consider_silent_notification -> no_notif as a straight line through
// the body of the unrelated "Event bus / Redis" node, clipping its
// sublabel, so at a glance the note read as belonging to Event bus — the
// same defect CTO-M1-04 was raised about, in a new form.
//
// The rule asserted here: a connector may touch the note it leaves and
// the target it names, and may cross a group frame's BORDER (a note
// outside a frame has to, to reach a node inside it), but it may not pass
// through any other node's footprint, any other note, or any group's
// title text.
//
// As with the distances above, the geometry is judged with this file's
// OWN segment/rect helper, deliberately NOT the renderer's, so the code
// under test cannot define away its own failure.

const GROUP_TITLE_X = 12; // render-svg.js draws the frame label at frame.x + 12 ...
const GROUP_TITLE_BASELINE = 22; // ... on a baseline at frame.y + 22 ...
const GROUP_TITLE_FONT = 13; // ... at 13px, unwrapped.

// Where that title text actually sits, re-derived here from the render
// offsets above rather than imported from the router's obstacle module.
function groupTitleBox(frame, label) {
  const text = Math.max(24, String(label || '').length * GROUP_TITLE_FONT * 0.62);
  return {
    x: frame.x + GROUP_TITLE_X,
    y: frame.y + GROUP_TITLE_BASELINE - GROUP_TITLE_FONT - 1,
    w: Math.min(text, Math.max(24, frame.w - GROUP_TITLE_X * 2)),
    h: 20,
  };
}

// Does the segment p->q pass through the INTERIOR of `rect`? Running
// along or touching an edge does not count: a connector is supposed to
// finish flush against the boxes it joins. Liang-Barsky, written out here
// rather than imported.
function segmentCrossesBox(p, q, rect) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clips = [
    [-dx, p.x - rect.x],
    [dx, rect.x + rect.w - p.x],
    [-dy, p.y - rect.y],
    [dy, rect.y + rect.h - p.y],
  ];
  for (const [num, den] of clips) {
    if (num === 0) {
      if (den < 0) return false;
      continue;
    }
    const t = den / num;
    if (num < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-6;
}

// Whatever geometry the connector declares: the routed points when it has
// them, otherwise the bare endpoints it has always carried. A connector
// that quietly went back to a straight line is judged as one.
function connectorPoints(connector) {
  if (Array.isArray(connector.points) && connector.points.length >= 2) {
    return connector.points.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
  }
  return [{ x: connector.x1, y: connector.y1 }, { x: connector.x2, y: connector.y2 }];
}

// Every "connector runs through X" offence in one layout, as readable
// strings so a failure names the node it cuts through.
function connectorOffences(layout, labelReserve, groups) {
  const nodes = Object.entries(layout.nodeBoxes).map(([id, b]) => ({
    id: `node ${id}`,
    owner: id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h + labelReserve,
  }));
  const notes = Object.entries(layout.noteBoxes).map(([id, b]) => ({ id: `note ${id}`, owner: id, x: b.x, y: b.y, w: b.w, h: b.h }));
  const titles = groups
    .filter(g => layout.frameBoxes[g.id])
    .map(g => ({ id: `group title ${g.id}`, owner: g.id, ...groupTitleBox(layout.frameBoxes[g.id], g.label) }));
  const all = [...nodes, ...notes, ...titles];

  const offences = [];
  Object.entries(layout.noteBoxes).forEach(([noteId, box]) => {
    (box.connectors || []).forEach(connector => {
      const points = connectorPoints(connector);
      // The note it leaves and the target it names are the two things it
      // is meant to touch; everything else is off limits.
      const obstacles = all.filter(o => o.owner !== noteId && o.owner !== connector.target);
      for (let i = 1; i < points.length; i++) {
        obstacles.forEach(o => {
          if (segmentCrossesBox(points[i - 1], points[i], o)) {
            offences.push(`${noteId} -> ${connector.target} runs through ${o.id}`);
          }
        });
      }
    });
  });
  return [...new Set(offences)].sort();
}

function countConnectors(layout) {
  return Object.values(layout.noteBoxes).reduce((n, b) => n + (b.connectors || []).length, 0);
}

// The `d` a renderer should emit for these points, rebuilt here so the
// markup is checked against the routed geometry rather than against
// itself.
function expectedPathData(layout) {
  const out = [];
  Object.values(layout.noteBoxes).forEach(box => {
    (box.connectors || []).forEach(c => {
      out.push(connectorPoints(c).map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
    });
  });
  return out.sort();
}

describe('CTO-M1-05: a note connector never runs through an unrelated node, note or group title', () => {
  test('interactive map: every connector reaches its target without crossing anything else', async () => {
    const layout = await layoutMap(medusaDoc);
    assert.ok(countConnectors(layout) > 0, 'the Medusa fixture should exercise at least one connector');
    assert.deepStrictEqual(connectorOffences(layout, LABEL_RESERVE, medusaDoc.groups), []);
  });

  test('the interactive markup draws exactly the route the layout computed', async () => {
    const layout = await layoutMap(medusaDoc);
    const html = await renderMap(medusaDoc);
    const drawn = [...html.matchAll(/class="note-link"[^>]*\sd="([^"]+)"/g)].map(m => m[1]).sort();
    assert.deepStrictEqual(drawn, expectedPathData(layout));
  });

  const layerSets = [[], ['business'], ['edge'], ['business', 'edge', 'build']];

  layerSets.forEach(layers => {
    test(`SVG export layers=${JSON.stringify(layers)}: no connector crosses anything else`, async () => {
      const { layout, labelReserve } = await buildDocSvg(medusaDoc, { layers });
      assert.deepStrictEqual(connectorOffences(layout, labelReserve, medusaDoc.groups), []);
    });
  });

  test('the SVG export draws exactly the route the layout computed', async () => {
    const { svg, layout } = await buildDocSvg(medusaDoc, { layers: ['business', 'edge', 'build'] });
    const drawn = [...svg.matchAll(/class="note-link"[^>]*\sd="([^"]+)"/g)].map(m => m[1]).sort();
    const expected = expectedPathData(layout);
    assert.ok(expected.length > 0, 'the full-layer export should carry at least one connector');
    assert.deepStrictEqual(drawn, expected);
  });
});

describe('CTO-M1-04: connectors are wired for layer toggling, not left dangling', () => {
  test('every rendered connector names a target that exists in the document', async () => {
    const html = await renderMap(medusaDoc);
    const targets = [...html.matchAll(/class="note-link" data-target="([^"]+)"/g)].map(m => m[1]);
    assert.ok(targets.length > 0, 'the interactive map should render at least one connector');
    const known = new Set([...medusaDoc.nodes.map(n => n.id), ...medusaDoc.groups.map(g => g.id)]);
    targets.forEach(t => assert.ok(known.has(t), `connector points at unknown target ${t}`));
  });

  test('a connector lives inside its note, so hiding the note hides the line too', async () => {
    const html = await renderMap(medusaDoc);
    const linkIndex = html.indexOf('class="note-link"');
    assert.ok(linkIndex > 0);
    const groupStart = html.lastIndexOf('<g class="n8n-note"', linkIndex);
    const groupEnd = html.indexOf('</g>', linkIndex);
    assert.ok(groupStart > 0 && groupEnd > linkIndex, 'connector must sit within a note group');
  });

  test('the static SVG draws connectors without any interactive wiring', async () => {
    const { svg } = await buildDocSvg(medusaDoc, { layers: ['business', 'edge', 'build'] });
    assert.doesNotMatch(svg, /data-target/, 'the static figure has no viewer to read data-* attributes');
    assert.match(svg, /stroke-dasharray="4 4"/, 'the connector line should still be drawn');
  });
});
