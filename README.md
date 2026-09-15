# SequentDraw

Generates architecture and business-process maps as self-contained interactive HTML.

One JSON file describes the system semantically. Layout is computed by ELK, never
authored. Layers can be toggled so the same map serves a developer and a client.

Not a diagram editor. The JSON is the product; the HTML is a view of it.

```
input  →  workflow.json  →  ELK layout  →  HTML render
         (semantic only)   (deterministic)  (deterministic)
```

## Status

Early. The prototype renderer is being brought into this repo. See
[`docs/HANDOVER.md`](docs/HANDOVER.md) for what was proven, known defects, and the
build order.
