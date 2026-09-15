// Pure: the bounding box of a frame's member node boxes (node plus its
// reserved label strip), padded and snapped to the grid, exactly the way
// layout.js's computeFrameBoxes always has. Extracted so the viewer can
// call the SAME computation against only the currently-visible members
// when a layer is toggled, without re-running layout or moving a node.
//
// Nodes never move when a layer is toggled (SPEC.md "Layout is computed
// against the union of all layers, once"); only a frame's own box (and
// its title, which sits at a fixed offset from that box's top-left)
// shrinks to fit what member nodes are still on screen. An empty
// `memberBoxes` list has no meaningful bounding box -- the caller
// (render-shell.js) hides the frame entirely in that case rather than
// calling this.
//
// render-shell.js's viewer inlines the identical body verbatim (it cannot
// require() this module in the browser). Deliberately written in the
// same plain var/function-expression style the rest of the inlined
// viewer script uses -- not this codebase's usual const/arrow style --
// so the two copies can be compared textually (whitespace aside) by the
// source-match test in tests/n8n-inlined-functions.test.js, rather than
// merely by behaviour.
function frameBoxFromMemberBoxes(memberBoxes, opts) {
  var labelReserve = opts.labelReserve, padding = opts.padding, grid = opts.grid;
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  memberBoxes.forEach(function(b){
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h + labelReserve);
  });
  var x = Math.floor((minX - padding.left) / grid) * grid;
  var y = Math.floor((minY - padding.top) / grid) * grid;
  var right = Math.ceil((maxX + padding.right) / grid) * grid;
  var bottom = Math.ceil((maxY + padding.bottom) / grid) * grid;
  return { x: x, y: y, w: right - x, h: bottom - y };
}

module.exports = { frameBoxFromMemberBoxes };
