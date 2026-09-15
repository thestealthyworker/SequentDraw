// frameBoxFromMemberBoxes: the shared bounding-box computation behind
// layout.js's computeFrameBoxes() and the viewer's runtime frame resize
// when a layer is toggled (docs/design/n8n-visual-style.md). Verifies the
// function directly, and that layout.js actually uses it (not a copy) by
// reproducing layout.frameBoxes exactly on the Medusa fixture.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { frameBoxFromMemberBoxes } = require('../src/n8n/frame-box');
const { layoutMap } = require('../src/n8n/layout');
const { LABEL_RESERVE, GROUP_PADDING, GRID } = require('../src/n8n/constants');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const OPTS = { labelReserve: LABEL_RESERVE, padding: GROUP_PADDING, grid: GRID };

describe('frameBoxFromMemberBoxes: unit behaviour', () => {
  test('a single member box is padded and snapped to the grid', () => {
    const box = frameBoxFromMemberBoxes([{ x: 100, y: 100, w: 96, h: 96 }], OPTS);
    assert.strictEqual(box.x % GRID, 0);
    assert.strictEqual(box.y % GRID, 0);
    assert.ok(box.x <= 100 - GROUP_PADDING.left);
    assert.ok(box.y <= 100 - GROUP_PADDING.top);
    assert.ok(box.x + box.w >= 100 + 96 + GROUP_PADDING.right);
    // The label strip below the node is included in the vertical extent.
    assert.ok(box.y + box.h >= 100 + 96 + LABEL_RESERVE + GROUP_PADDING.bottom);
  });

  test('a subset of members produces a box contained within the box for all members', () => {
    const all = [
      { x: 0, y: 0, w: 96, h: 96 },
      { x: 300, y: 200, w: 96, h: 96 },
      { x: 150, y: -100, w: 96, h: 96 },
    ];
    const fullBox = frameBoxFromMemberBoxes(all, OPTS);
    const subsetBox = frameBoxFromMemberBoxes([all[0]], OPTS);
    assert.ok(subsetBox.x >= fullBox.x);
    assert.ok(subsetBox.y >= fullBox.y);
    assert.ok(subsetBox.x + subsetBox.w <= fullBox.x + fullBox.w);
    assert.ok(subsetBox.y + subsetBox.h <= fullBox.y + fullBox.h);
  });
});

describe('frameBoxFromMemberBoxes: parity with layout.js on the Medusa fixture', () => {
  let layout;

  test('layoutMap resolves', async () => {
    layout = await layoutMap(doc);
    assert.ok(layout.frameBoxes);
  });

  test('with every layer on, recomputing from ALL members reproduces layout.frameBoxes exactly', () => {
    doc.groups.forEach(g => {
      const memberIds = doc.nodes.filter(n => n.parentId === g.id).map(n => n.id);
      if (!memberIds.length) return;
      const memberBoxes = memberIds.map(id => layout.nodeBoxes[id]);
      const recomputed = frameBoxFromMemberBoxes(memberBoxes, OPTS);
      const actual = layout.frameBoxes[g.id];
      assert.deepStrictEqual(recomputed, { x: actual.x, y: actual.y, w: actual.w, h: actual.h }, `frame ${g.id} mismatch`);
    });
  });

  test('with Business off, every frame with a visible member still contains all its visible members and is no larger than before', () => {
    const nodeById = new Map(doc.nodes.map(n => [n.id, n]));
    const isVisibleWithoutBusiness = id => {
      const layers = nodeById.get(id).layers && nodeById.get(id).layers.length ? nodeById.get(id).layers : ['base'];
      return layers.some(l => l !== 'business');
    };

    let groupsWithVisibleMembers = 0;
    doc.groups.forEach(g => {
      const memberIds = doc.nodes.filter(n => n.parentId === g.id).map(n => n.id);
      if (!memberIds.length) return;
      const visibleIds = memberIds.filter(isVisibleWithoutBusiness);
      if (!visibleIds.length) return; // frame itself would be hidden — nothing to check
      groupsWithVisibleMembers++;

      const originalBox = layout.frameBoxes[g.id];
      const visibleBoxes = visibleIds.map(id => layout.nodeBoxes[id]);
      const shrunk = frameBoxFromMemberBoxes(visibleBoxes, OPTS);

      // No larger than before: contained within the original box.
      assert.ok(shrunk.x >= originalBox.x, `${g.id}: shrunk.x should be >= original`);
      assert.ok(shrunk.y >= originalBox.y, `${g.id}: shrunk.y should be >= original`);
      assert.ok(shrunk.x + shrunk.w <= originalBox.x + originalBox.w, `${g.id}: shrunk right edge should be <= original`);
      assert.ok(shrunk.y + shrunk.h <= originalBox.y + originalBox.h, `${g.id}: shrunk bottom edge should be <= original`);

      // Still contains every visible member's full footprint (node + label strip).
      visibleIds.forEach(id => {
        const b = layout.nodeBoxes[id];
        assert.ok(b.x >= shrunk.x && b.y >= shrunk.y, `${g.id}: member ${id} top-left outside shrunk frame`);
        assert.ok(b.x + b.w <= shrunk.x + shrunk.w, `${g.id}: member ${id} right edge outside shrunk frame`);
        assert.ok(b.y + b.h + LABEL_RESERVE <= shrunk.y + shrunk.h, `${g.id}: member ${id} label strip outside shrunk frame`);
      });
    });
    // Sanity: the Medusa fixture actually exercises this (has groups with
    // a mix of business and non-business members).
    assert.ok(groupsWithVisibleMembers > 0);
  });
});
