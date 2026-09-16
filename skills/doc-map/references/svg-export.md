# SVG export contract

What `sequentdraw render <in.json> <out.svg> --layers a,b` guarantees, so
this skill knows what it can and cannot rely on:

| Aspect | Guarantee |
|---|---|
| Format | One standalone `.svg` file: no script, no external references, system font stack only. |
| Captions | Each node's `description`, wrapped to at most 2 lines at 12px, ending in "…" if longer. A node with no `description` gets no caption -- which is exactly why this skill drafts one before exporting. |
| Layers | `base` is always included; the layers chosen at export time control what else appears. Nodes outside the chosen layers are omitted entirely, not stubbed. |
| Notes | Sticky notes render as in the interactive view; a note's link becomes plain underlined text (an image cannot be clicked). |
| Security | Every value is escaped for its context; no `<script>`, `<foreignObject>` or event attribute; no `href` values at all. |

So: descriptions are the one thing this skill can add value by drafting
(step 3 of `SKILL.md`); everything else about the figure is the renderer's
job, not this skill's.
