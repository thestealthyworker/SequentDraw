// Pure decision for whether a handle (the small dot at a node's edge
// attachment point) should be visible, given the current visibility of
// every edge attached to it.
//
// docs/design/n8n-visual-style.md "Handles and edges": a node's shared
// main-in handle serves every inbound edge; its shared main-out handle
// serves every plain (non-condition) outbound edge; a branch handle
// serves exactly one condition-carrying outbound edge, label included.
// In every case the rule is the same: the handle is visible iff at
// least one of the edges attached to it is visible (see
// edge-visibility.js's isEdgeVisible for what "an edge is visible"
// means). A hidden node's own handles fall out of this automatically --
// every edge touching a hidden node is itself hidden on that end, so
// the attached-edge-visibility list passed in is all-false.
//
// render-shell.js's viewer inlines the identical one-line body (it
// cannot require() this module in the browser); the source-match test
// in tests/n8n-inlined-functions.test.js keeps the two from drifting.
function isHandleVisible(attachedEdgeVisibilities) {
  return attachedEdgeVisibilities.some(Boolean);
}

module.exports = { isHandleVisible };
