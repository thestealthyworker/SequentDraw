// isEdgeVisible: an edge is visible only when BOTH endpoints are visible.
// Owner decision (2026-09-15), overriding SPEC.md's per-edge "stub" rule
// for this renderer: no more half-drawn edges with a stub circle at the
// hidden end. See src/n8n/edge-visibility.js for the full rationale — the
// identical one-line body is inlined into render-shell.js's viewer script
// (the browser cannot require() this module), so this file is the only
// place the rule itself is unit-tested.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { isEdgeVisible } = require('../src/n8n/edge-visibility');

describe('isEdgeVisible(fromVisible, toVisible)', () => {
  test('both endpoints visible -> visible', () => {
    assert.strictEqual(isEdgeVisible(true, true), true);
  });

  test('from hidden, to visible -> hidden', () => {
    assert.strictEqual(isEdgeVisible(false, true), false);
  });

  test('from visible, to hidden -> hidden', () => {
    assert.strictEqual(isEdgeVisible(true, false), false);
  });

  test('both endpoints hidden -> hidden', () => {
    assert.strictEqual(isEdgeVisible(false, false), false);
  });

  test('undefined (endpoint not found in the visibility map) is treated as hidden', () => {
    assert.strictEqual(isEdgeVisible(undefined, true), false);
    assert.strictEqual(isEdgeVisible(true, undefined), false);
    assert.strictEqual(isEdgeVisible(undefined, undefined), false);
  });
});
