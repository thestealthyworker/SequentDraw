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
