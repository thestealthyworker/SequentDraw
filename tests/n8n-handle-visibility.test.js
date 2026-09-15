// isHandleVisible: a handle (shared main-in, shared main-out, or a
// dedicated branch handle) is visible iff at least one of the edges
// attached to it is visible. See src/n8n/handle-visibility.js for the
// full rationale — the identical one-line body is inlined into
// render-shell.js's viewer script, exercised for drift in
// tests/n8n-inlined-functions.test.js.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { isHandleVisible } = require('../src/n8n/handle-visibility');

describe('isHandleVisible(attachedEdgeVisibilities)', () => {
  test('all attached edges visible -> handle visible', () => {
    assert.strictEqual(isHandleVisible([true, true, true]), true);
  });

  test('one neighbour (edge) hidden among several -> handle stays visible', () => {
    assert.strictEqual(isHandleVisible([true, false, true]), true);
  });

  test('all attached edges hidden -> handle hidden', () => {
    assert.strictEqual(isHandleVisible([false, false, false]), false);
  });

  test('a branch handle with only its own (single) branch edge, visible -> handle visible', () => {
    assert.strictEqual(isHandleVisible([true]), true);
  });

  test('a branch handle with only its own (single) branch edge, hidden -> handle hidden', () => {
    assert.strictEqual(isHandleVisible([false]), false);
  });

  test('no attached edges at all -> handle hidden (vacuous case, e.g. a handle that should not have been drawn)', () => {
    assert.strictEqual(isHandleVisible([]), false);
  });
});
