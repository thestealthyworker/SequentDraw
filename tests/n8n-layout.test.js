// Invariant tests for the n8n-style renderer, run against the Medusa
// fixture. See docs/design/n8n-visual-style.md "Testing".

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { layoutMap } = require('../src/n8n/layout');
const { renderHtml } = require('../src/n8n/render');
const { LABEL_RESERVE, GRID } = require('../src/n8n/constants');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function footprint(box) {
  return { x: box.x, y: box.y, w: box.w, h: box.h + LABEL_RESERVE };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('n8n layout on the Medusa fixture', () => {
  let layout;
  let html;

  test('layoutMap resolves without throwing', async () => {
    layout = await layoutMap(doc);
    assert.ok(layout);
  });

  test('every node box has all 40 nodes placed', () => {
    assert.strictEqual(Object.keys(layout.nodeBoxes).length, doc.nodes.length);
  });

  test('no two node footprints overlap (node + reserved label area)', () => {
    const ids = Object.keys(layout.nodeBoxes);
    const boxes = ids.map(id => ({ id, ...footprint(layout.nodeBoxes[id]) }));
    const collisions = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i], boxes[j])) collisions.push(`${boxes[i].id} / ${boxes[j].id}`);
      }
    }
    assert.deepStrictEqual(collisions, []);
  });

  test('every node x and y is a multiple of 16', () => {
    const offGrid = Object.entries(layout.nodeBoxes)
      .filter(([, b]) => b.x % GRID !== 0 || b.y % GRID !== 0)
      .map(([id]) => id);
    assert.deepStrictEqual(offGrid, []);
  });

  test('every edge path starts and ends within 1px of its handles', () => {
    const bad = [];
    for (const edge of layout.edges) {
      // Tokenize the path data into plain numbers, dropping command letters
      // (M/L/Q/C) and any Z terminator — works for both the bezier and the
      // rounded-orthogonal detour paths this renderer emits.
      const nums = edge.d
        .replace(/[MLQCZ]/g, ' ')
        .trim()
        .split(/\s+/)
        .map(Number);
      const [startX, startY] = nums;
      const [endX, endY] = nums.slice(-2);
      const startDist = Math.hypot(startX - edge.start[0], startY - edge.start[1]);
      const endDist = Math.hypot(endX - edge.end[0], endY - edge.end[1]);
      if (startDist > 1) bad.push(`edge ${edge.index} start off by ${startDist.toFixed(2)}px`);
      if (endDist > 1) bad.push(`edge ${edge.index} end off by ${endDist.toFixed(2)}px`);
    }
    assert.deepStrictEqual(bad, []);
  });

  test('every frame box contains its members\' boxes including labels', () => {
    const bad = [];
    for (const [groupId, frame] of Object.entries(layout.frameBoxes)) {
      for (const memberId of frame.memberIds) {
        const b = layout.nodeBoxes[memberId];
        const fp = footprint(b);
        const contained =
          fp.x >= frame.x && fp.y >= frame.y && fp.x + fp.w <= frame.x + frame.w && fp.y + fp.h <= frame.y + frame.h;
        if (!contained) bad.push(`${memberId} not contained in frame ${groupId}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('renderHtml produces output with no http(s) references beyond the SVG xmlns', () => {
    html = renderHtml(layout, doc);
    const refs = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const unexpected = refs.filter(r => r !== 'http://www.w3.org/2000/svg');
    assert.deepStrictEqual(unexpected, []);
  });

  test('renderHtml output is a complete, non-empty HTML document', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.length > 1000);
  });
});
