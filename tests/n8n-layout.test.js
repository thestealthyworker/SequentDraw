// Invariant tests for the n8n-style renderer, run against the Medusa
// fixture. See docs/design/n8n-visual-style.md "Testing".

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { layoutMap } = require('../src/n8n/layout');
const { renderHtml } = require('../src/n8n/render');
const { LABEL_RESERVE, GRID } = require('../src/n8n/constants');
const { labelBoxesOf, frameTitleBoxesOf } = require('../src/n8n/obstacles');
const { samplePath, pointInRect } = require('../src/n8n/sample-path');

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

  test('no edge path crosses a label box or a frame title box', () => {
    const labelBoxes = labelBoxesOf(layout.nodeBoxes);
    const frameTitleBoxes = frameTitleBoxesOf(doc.groups, layout.frameBoxes);
    const textBoxes = labelBoxes.concat(frameTitleBoxes);
    const bad = [];
    for (const edge of layout.edges) {
      const pts = samplePath(edge.d);
      for (const box of textBoxes) {
        if (pts.some(pt => pointInRect(pt, box))) bad.push(`edge ${edge.index} crosses text box ${box.id}`);
      }
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

  test('renderHtml loads no external resources (self-contained, per SPEC.md "no dependencies")', () => {
    // Notes may contain http(s) links, which are opened on click and never
    // fetched. So an http(s) URL is allowed only as the href of an <a>, and
    // every element or construct that loads a resource on open is banned
    // outright, SVG-native ones included. The map must open by double-click
    // and survive being emailed.
    html = renderHtml(layout, doc);
    const loaders = html.match(
      /<script[^>]*\bsrc\s*=|<link\b|<img\b|<image\b|<use\b|<iframe\b|<object\b|<embed\b|<foreignObject\b|@import|url\(\s*['"]?\s*(?:https?:)?\/\/|xlink:href\s*=\s*["']?\s*(?:https?:)?\/\/|\bsrcset\s*=/gi
    ) || [];
    assert.deepStrictEqual(loaders, []);

    // A node/edge `link` or `description` can also carry an http(s) URL,
    // but those only ever reach the page as data inside the details-card
    // JSON embedded in the single inline <script> (see render-shell.js) —
    // the viewer only turns one into a clickable <a href> at runtime, on
    // demand, exactly like a note's link is opened on click and never
    // fetched. So a URL inside the script block is data, not a resource
    // load, and is excluded from this check the same way an <a href> is.
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const scriptContent = scriptMatch ? scriptMatch[1] : '';
    const htmlOutsideScript = scriptMatch ? html.replace(scriptContent, '') : html;

    const anchorHrefs = new Set([...html.matchAll(/<a\s[^>]*\bhref="([^"]*)"/g)].map(m => m[1]));
    const urls = (htmlOutsideScript.match(/https?:\/\/[^\s"'<>)]+/g) || [])
      .filter(url => url !== 'http://www.w3.org/2000/svg')
      .filter(url => ![...anchorHrefs].some(href => href.startsWith(url)));
    assert.deepStrictEqual(urls, [], 'http(s) URLs outside the inline <script> may only appear as <a href> values');
  });

  test('renderHtml output is a complete, non-empty HTML document', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.length > 1000);
  });
});
