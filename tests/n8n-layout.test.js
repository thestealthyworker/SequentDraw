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

// Pulls the one `var CARD_DATA = <json literal>;` statement out of the
// inline script's source, by the same fixed statement boundary
// render-shell.js always emits around it (the next declaration,
// `var nodeCardsById`), rather than a regex that would have to somehow
// parse balanced JSON out of a string that may itself contain adversarial
// content. Returns the literal's raw text (for JSON.parse) and the script
// source with that literal excised, for the network-access scan below.
// Two embedded JSON literals carry authored text into the page as inert
// data: CARD_DATA (the details cards) and SOURCE_DOC (the document
// correction mode writes a corrected copy of -- docs/design/correction-mode.md).
// Both can legitimately hold an http(s) URL, because a node `link`, a note
// link or a description may be one. Each is cut out by its own exact
// boundary and proved to be real JSON, so the network check below scans
// everything else -- a much narrower exemption than "the script does not
// count".
function extractDataLiteral(scriptContent, marker, terminator) {
  const start = scriptContent.indexOf(marker);
  if (start < 0) throw new Error(`${marker.trim()} literal not found in script`);
  const afterMarker = start + marker.length;
  const end = scriptContent.indexOf(terminator, afterMarker);
  if (end < 0) throw new Error(`${marker.trim()} literal not terminated at the expected boundary`);
  return {
    json: scriptContent.slice(afterMarker, end),
    rest: scriptContent.slice(0, afterMarker) + scriptContent.slice(end),
  };
}

function extractCardDataLiteral(scriptContent) {
  const card = extractDataLiteral(scriptContent, 'var CARD_DATA = ', ';\n  var nodeCardsById');
  const source = extractDataLiteral(card.rest, 'var SOURCE_DOC = ', ';\n  var FRAGMENT_MODE');
  return {
    cardDataJson: card.json,
    sourceDocJson: source.json,
    scriptWithoutCardData: source.rest,
  };
}

// Strips `//` line comments, quote-aware: a "//" is only a comment start
// when it is not inside a '...' or "..." string on that line. A naive
// `line.replace(/\/\/.*$/, '')` would also truncate a line at the FIRST
// "//" it sees even when that "//" is part of an "https://" URL sitting
// inside a string literal (real code, not a comment) earlier on the same
// line — silently hiding exactly the thing this check exists to catch.
function stripLineComments(source) {
  return source
    .split('\n')
    .map(line => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble && ch === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

// This file's and render-shell.js's own prose both name these
// identifiers, to explain why they're absent — comment-stripped first so
// that doesn't false-positive. Scanned for any http(s) URL text and for
// the specific network/resource-loading APIs a self-contained,
// double-click-to-open viewer must never call.
const BANNED_NETWORK_APIS = ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'EventSource(', 'sendBeacon', 'import(', 'new Image(', '.src =', '.src=', 'srcset', 'ping', 'url('];

function findNetworkAccessViolations(scriptSource) {
  const codeOnly = stripLineComments(scriptSource);
  const urls = codeOnly.match(/https?:\/\//g) || [];
  const apis = BANNED_NETWORK_APIS.filter(api => codeOnly.includes(api));
  return { urls, apis };
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
    // JSON literal embedded in the single inline <script> (see
    // render-shell.js) — the viewer only turns one into a clickable
    // <a href> at runtime, on demand, exactly like a note's link is
    // opened on click and never fetched. Rather than exempt the whole
    // script from the URL/network check, extract and JSON.parse that one
    // literal out, then scan everything else — a much narrower, harder to
    // abuse exemption than "the script doesn't count".
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, 'expected exactly one inline <script>');
    const scriptContent = scriptMatch[1];
    const { cardDataJson, sourceDocJson, scriptWithoutCardData } = extractCardDataLiteral(scriptContent);
    assert.doesNotThrow(() => JSON.parse(cardDataJson), 'the extracted card-data literal must really be JSON, i.e. inert data');
    assert.doesNotThrow(() => JSON.parse(sourceDocJson), 'the extracted source-document literal must really be JSON, i.e. inert data');

    const violations = findNetworkAccessViolations(scriptWithoutCardData);
    assert.deepStrictEqual(violations.urls, [], 'the script (outside the embedded card-data literal) must contain no http(s) URL text');
    assert.deepStrictEqual(violations.apis, [], `the script (outside the embedded card-data literal) must not use: ${violations.apis.join(', ')}`);

    const htmlOutsideScript = html.replace(scriptContent, '');
    const anchorHrefs = new Set([...html.matchAll(/<a\s[^>]*\bhref="([^"]*)"/g)].map(m => m[1]));
    const urls = (htmlOutsideScript.match(/https?:\/\/[^\s"'<>)]+/g) || [])
      .filter(url => url !== 'http://www.w3.org/2000/svg')
      .filter(url => ![...anchorHrefs].some(href => href.startsWith(url)));
    assert.deepStrictEqual(urls, [], 'http(s) URLs outside the inline <script> may only appear as <a href> values');
  });

  test('the network-access check actually catches a mutation (proves it is not vacuous)', () => {
    // Same scan as above, run against a deliberately sabotaged copy of the
    // real script: if this test ever passed with an empty violations list,
    // the check above would be worthless.
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const { scriptWithoutCardData } = extractCardDataLiteral(scriptMatch[1]);
    const mutated = scriptWithoutCardData + "\n  fetch('https://example.com');\n";
    const violations = findNetworkAccessViolations(mutated);
    assert.ok(violations.urls.length > 0, 'the mutation check should have found the injected http(s) URL');
    assert.ok(violations.apis.includes('fetch('), 'the mutation check should have found the injected fetch(...) call');
  });

  test('renderHtml output is a complete, non-empty HTML document', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.length > 1000);
  });
});
