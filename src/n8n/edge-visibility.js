// Pure decision for whether an edge should be visible given whether each of
// its endpoints is currently visible under the active layer filter.
//
// Owner decision (2026-09-15), overriding SPEC.md's per-edge "stub" rule for
// this renderer: an edge is visible only when BOTH endpoints are visible.
// If either endpoint is hidden -- including a node hidden because it
// belongs to a layer that is off, even while its group's frame stays
// visible because another member is still shown -- the whole edge (line,
// arrowhead, hit path, and any label) is hidden. Nothing is lost to the
// reader: the details card still lists the connection, tagged "(hidden)"
// (see card-data.js), so there is no dangling arrow and no silently
// dropped connection either.
//
// This is the single source of truth for the rule: render-shell.js's
// viewer script inlines the identical one-line body (it cannot `require()`
// this module in the browser), and the Node-side tests in
// tests/n8n-edge-visibility.test.js exercise this copy directly.
function isEdgeVisible(fromVisible, toVisible) {
  return !!fromVisible && !!toVisible;
}

module.exports = { isEdgeVisible };
