---
name: doc-map
description: Export an existing SequentDraw workflow map as a static SVG documentation figure with inline captions -- for a doc, slide, PDF or pasted screenshot that cannot hover. Trigger phrases -- "export this workflow map as an image for our docs", "give me a static SVG of this map", "I need a picture of this map for a slide", "export the workflow for a slide", "turn this map into a figure". Reads the map the user names (or one already in the conversation), asks which layers to include, drafts a short description for any included node missing one and shows the drafts for confirmation before writing them, validates, then renders the SVG. NOT for building a new n8n workflow, NOT a general Mermaid or chart tool, NOT for reviewing or grilling a plan with no existing map, and NOT for mapping a repository from scratch -- run git-map first if no map exists yet, then doc-map.
when_to_use: Use once a SequentDraw map (JSON or an already-rendered map) exists and the user wants a static, non-interactive image of it for documentation, a slide, a PDF or anywhere hover cards do not work. Do not use to change what the map contains -- only descriptions the user confirms may be added.
---

# doc-map

Export an existing SequentDraw workflow map as a static SVG figure with
inline captions (see `references/svg-export.md` for the full output
contract). This skill never invents structure -- it only exports what is
already there, plus node descriptions the user explicitly confirms.

## Steps

1. **Find the map.** Use the workflow JSON path the user named, or one
   already produced earlier in the conversation. If neither exists, tell the
   user no map exists yet and stop -- do not build one. (If they actually
   want a map of a repository, that is `git-map`, not this skill.)

2. **Settle which layers to include.** `base` is always included. If the user
   already named the layers ("base layer only", "with the business layer"),
   use exactly those and do not ask again. Otherwise list the other layers
   the document declares (`edge`, `business`, `build`) and ask which to add.

3. **Missing descriptions: offer, never block.** For every node in the
   included layers that has no `description`, draft one of at most 12 words
   (the caption wraps onto as many 12px lines as it needs, in full). If the user is
   available and has not said to skip questions, show the drafts as a
   numbered list and write only the ones they confirm. If they said not to
   ask, or no one is there to confirm, write none of them: render without
   those captions, and list the drafts in your final reply so they can be
   added later. Never touch any other field.

4. **Validate, then write the local copy first.** Render into a folder
   outside the repository (a session folder, or a path under the system
   temp directory), never into the repository. The CLI creates the output
   directory itself, so do not make it first. When the map is unchanged,
   point both commands at the file:
   ```
   <sequentdraw> validate map.json
   <sequentdraw> render map.json <folder>/map.svg --layers <chosen-layers>
   ```
   When you added confirmed descriptions, do not write the changed document
   back through a shell string: pipe it in instead. `-` reads the input
   document from stdin, and a quoted heredoc keeps the command starting
   with the CLI (the `'EOF'` quotes stop the shell expanding anything in
   the JSON):
   ```
   <sequentdraw> validate - <<'EOF'
   { ...the updated map document... }
   EOF
   <sequentdraw> render - <folder>/map.svg --layers <chosen-layers> <<'EOF'
   { ...the updated map document... }
   EOF
   ```
   Only the input may be `-`; the output is always a real path.
   Run each of these as its own command, beginning with `<sequentdraw>`.
   Never chain one behind `mkdir ... &&`, `echo ... |` or any other prefix:
   a host may grant the CLI narrowly -- this plugin's own CI grants
   `Bash(node:*)` -- and such a grant matches only a command that *starts*
   with what was granted, so a chained call is refused outright.
   The CLI prints `wrote <path> (<size>kb)`. Keep that output and print the
   path, so the figure exists on disk even if publishing is unavailable.
   `<sequentdraw>` means `node "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" ...`
   when that variable is set (an installed Claude Code plugin), falling
   back to `npx sequentdraw ...` when it is not (Codex, or any other host)
   -- `scripts/sequentdraw.sh` implements exactly that resolution. If
   validation fails, fix only the descriptions just confirmed and re-run;
   never patch around an unrelated existing error without telling the
   user.

5. **Output like an artifact -- see `references/artifact-output.md`.** In
   Claude Code: publish a private Claude artifact (an HTML page that shows
   the SVG inline) and give the user the link; artifact pages cannot offer
   file downloads, so the actual `.svg` file comes from the local copy.
   Always also write the local copy (`map.svg`, plus the updated `map.json`
   when descriptions were added and the host has a file-writing tool;
   without one, list the confirmed descriptions in your reply instead) to
   a temp or session folder outside the repository, and print the paths.
   Write into the repository only if the user asks, and ask before
   overwriting anything there.
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
