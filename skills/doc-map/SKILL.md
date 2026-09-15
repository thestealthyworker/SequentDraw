---
name: doc-map
description: Export an existing SequentDraw workflow map as a static SVG documentation figure with inline captions -- for a doc, slide, PDF or pasted screenshot that cannot hover. Trigger phrases -- "export this workflow map as an image for our docs", "give me a static SVG of this map", "I need a picture of this map for a slide", "export the workflow for a slide", "turn this map into a figure". Reads the map the user names (or one already in the conversation), asks which layers to include, drafts a short description for any included node missing one and shows the drafts for confirmation before writing them, validates, then renders the SVG. NOT for building a new n8n workflow, NOT a general Mermaid or chart tool, NOT for reviewing or grilling a plan with no existing map, and NOT for mapping a repository from scratch -- run git-map first if no map exists yet, then doc-map.
when_to_use: Use once a SequentDraw map (JSON or an already-rendered map) exists and the user wants a static, non-interactive image of it for documentation, a slide, a PDF or anywhere hover cards do not work. Do not use to change what the map contains -- only descriptions the user confirms may be added.
---

# doc-map

Export an existing SequentDraw workflow map as a static SVG figure with inline
captions (`docs/design/n8n-visual-style.md`, "Documentation export"). This
skill never invents structure -- it only exports what is already there, plus
node descriptions the user explicitly confirms.

## Steps

1. **Find the map.** Use the workflow JSON path the user named, or one
   already produced earlier in the conversation. If neither exists, tell the
   user no map exists yet and stop -- do not build one. (If they actually
   want a map of a repository, that is `git-map`, not this skill.)

2. **Ask which layers to include.** `base` is always included. List the
   other layers present in the document (`edge`, `business`, `build` --
   whichever the doc actually declares) and ask which to add. Do not assume;
   a documentation figure should show exactly what it is about.

3. **Draft missing descriptions, then get confirmation.** For every node in
   the *included* layers that has no `description`, draft one of at most 12
   words (the SVG caption wraps to 2 lines at 12px and truncates). Show every
   draft to the user as a numbered list before writing anything. Only write
   the descriptions the user confirms; skip or redo the rest per their
   feedback. Never touch any other field.

4. **Validate, then render.**
   ```
   <sequentdraw> validate map.json
   <sequentdraw> render map.json map.svg --layers <chosen-layers>
   ```
   (`<sequentdraw>` = `scripts/sequentdraw.sh`, which resolves the CLI --
   see that script.) If validation fails, fix only the descriptions just
   confirmed and re-run; never patch around an unrelated existing error
   without telling the user.

5. **Output like an artifact -- see `references/artifact-output.md`.** In
   Claude Code: publish a private Claude artifact (an HTML page that shows
   the SVG inline) and give the user the link; artifact pages cannot offer
   file downloads, so the actual `.svg` file comes from the local copy.
   Always also write the local copy (`map.svg` and the updated `map.json`,
   if descriptions were added) to a temp or session folder outside the
   repository, and print both paths. Write into the repository only if the
   user asks, and ask before overwriting anything there.
   In Codex, other agents, or a CLI-only host: skip the artifact step and
   just open or print the local file paths.

## Boundaries

- Never invents nodes, edges, groups or structure -- it exports the map as
  it exists.
- Never changes anything except node descriptions the user has confirmed in
  step 3.
- Not for building or editing an n8n workflow (that is n8n's own skills).
- Not a general Mermaid, sequence-diagram or chart tool.
- Not for reviewing, evaluating or "grilling" an architecture -- that is
  `eval-build` / `grill-build` (not yet shipped). If the user wants a review
  rather than a picture, say so and stop.
- If no map exists yet, this skill does not create one. Point the user to
  `git-map` first (for a repository) and come back to `doc-map` once that
  map exists.

## Details

See `references/svg-export.md` for the exact SVG output contract this skill
relies on, and `references/artifact-output.md` for the full artifact rule
this skill (and every SequentDraw skill) follows.
