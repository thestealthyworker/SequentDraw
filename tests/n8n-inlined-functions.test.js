// The viewer (render-shell.js) cannot require() a Node module in the
// browser, so it inlines an identical copy of each small pure decision
// function this feature added: isEdgeVisible (edge-visibility.js),
// isHandleVisible (handle-visibility.js), and frameBoxFromMemberBoxes
// (frame-box.js). These tests keep the inlined copy from drifting from
// its module source by comparing both with all whitespace stripped —
// tolerant of reindentation inside the template literal, intolerant of
// any real change to the logic (a renamed variable, a different
// operator, an added/removed line all fail this).

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { isEdgeVisible } = require('../src/n8n/edge-visibility');
const { isHandleVisible } = require('../src/n8n/handle-visibility');
const { frameBoxFromMemberBoxes } = require('../src/n8n/frame-box');
const { script } = require('../src/n8n/render-shell');

const EMPTY_GEOMETRY = {
  nodeBoxes: {},
  labelReserve: 48,
  padding: { top: 40, left: 24, right: 24, bottom: 24 },
  grid: 16,
  frameLabelOffsetX: 12,
  frameLabelOffsetY: 22,
};

const VIEWER_SOURCE = script({ x: 0, y: 0, width: 100, height: 100 }, { nodes: [], edges: [] }, EMPTY_GEOMETRY);

function stripWhitespace(src) {
  return src.replace(/\s+/g, '');
}

// Extracts one `function <name>(...) { ... }` from the viewer source by
// brace matching from the `function <name>` keyword, so a nested `{ }` in
// the body (there are several, in frameBoxFromMemberBoxes) doesn't cut it
// short.
function extractInlinedFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `expected an inlined "${marker}" in the viewer script`);
  const braceOpen = source.indexOf('{', start);
  assert.ok(braceOpen >= 0);
  let depth = 0;
  for (let i = braceOpen; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function body for "${name}"`);
}

describe('inlined viewer functions match their Node module source exactly (whitespace aside)', () => {
  test('isEdgeVisible', () => {
    const moduleSrc = stripWhitespace(isEdgeVisible.toString());
    const inlinedSrc = stripWhitespace(extractInlinedFunction(VIEWER_SOURCE, 'isEdgeVisible'));
    assert.strictEqual(inlinedSrc, moduleSrc);
  });

  test('isHandleVisible', () => {
    const moduleSrc = stripWhitespace(isHandleVisible.toString());
    const inlinedSrc = stripWhitespace(extractInlinedFunction(VIEWER_SOURCE, 'isHandleVisible'));
    assert.strictEqual(inlinedSrc, moduleSrc);
  });

  test('frameBoxFromMemberBoxes', () => {
    const moduleSrc = stripWhitespace(frameBoxFromMemberBoxes.toString());
    const inlinedSrc = stripWhitespace(extractInlinedFunction(VIEWER_SOURCE, 'frameBoxFromMemberBoxes'));
    assert.strictEqual(inlinedSrc, moduleSrc);
  });

  test('a deliberately drifted inlined copy is caught (proves the comparison is not vacuous)', () => {
    const moduleSrc = stripWhitespace(isEdgeVisible.toString());
    const drifted = stripWhitespace('function isEdgeVisible(fromVisible, toVisible){ return !!fromVisible || !!toVisible; }');
    assert.notStrictEqual(drifted, moduleSrc, '&& mutated to || should not match the real module body');
  });
});
