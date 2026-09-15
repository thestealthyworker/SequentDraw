# Examples

## `medusa-return-flow.json`

40 nodes, 5 groups, 44 edges, 4 layers. Hand-written from Medusa's published order
return (RMA) documentation. This is the layout regression fixture: it is deliberately
harder than a typical input, since 15 of its 44 edges cross layers.

**Provenance.** The original JSON stayed in the claude.ai session where the prototype
was built. This copy was rebuilt from the prototype's rendered output
(`reference/medusa-return-flow.html`): groups, nodes, labels, layers, glyph kinds,
brand icons and edge order were read back out of the HTML.

Re-rendering it reproduces the reference exactly: same 933×2890 canvas, zero node
displacement, identical group boxes. `tests/layout-regression.test.js` enforces this.

What the HTML could not recover:

- **Edge `condition` text.** The prototype did not draw conditions, so every edge
  here has `condition: null`. The `solid` or `dashed` type is recovered.
- **`kind` on brand-icon nodes.** When a brand icon resolves, the renderer ignores
  `kind`, so those seven nodes are set to `service`.

**Sticky notes.** Four `notes` were added after the rebuild to exercise that feature:
a map-level note, one attached to the Fulfillment group, one on the `business` layer
attached to `receive` and `inspect`, and a red `edge`-layer note on `refund_check`.
The legacy renderer ignores `notes`, so the regression test above is unaffected.

The owner has set aside the original JSON until the final-product re-test.

## `reference/medusa-return-flow.html`

Output of the web prototype, kept as a frozen visual and positional baseline. Do not
edit it. Some brand-icon path numbers were copied with extra trailing zeros; the
values are the same and the rendering is unaffected.

## `stampedid-workflow.json`

Not recovered. 15 nodes from a real project, intended for testing extraction
accuracy. The owner has set it aside until the final-product re-test.
