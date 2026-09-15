# Artifact output rule

The same rule every SequentDraw skill follows -- see
`docs/design/skills-and-plugin.md`, "Rules every skill keeps", and
`docs/design/git-map.md` section 4.

## In Claude Code

1. Render with the fragment mode (`sequentdraw render map.json map.html
   --fragment`) and publish it as a **private Claude artifact**. Give the
   user the link. Say the page is private by default and is never shared
   further.
2. **Always** also keep `map.json` and `map.html` in a session or temp
   folder outside the repository, and print both paths -- this must happen
   even when this skill is running as a forked subagent (`context: fork`),
   since the fork has no other way to hand the result back to the user.
3. Write into the repository **only when the user asks**
   ("save it to docs/architecture"), and **ask before overwriting**
   anything already there.
4. A conversational correction ("Stripe belongs in Payment") edits the
   JSON, re-validates, re-checks evidence, and republishes to the *same*
   artifact -- never a new one.

## Outside Claude Code (Codex, other agents, CLI-only hosts)

No artifacts. Write the same two files to a temp folder and open/print
them locally instead.

## Why a fragment, not the full page

The full-document render (no `--fragment`) supplies its own `<!DOCTYPE>`,
`<html>`, `<head>` and `<body>` -- exactly what an artifact host's own
skeleton already provides. The fragment (`<title>`, `<style>`, the map
markup, one `<script>`) avoids a doubled shell and keeps the page passing
the artifact sandbox, which blocks external requests -- something this
viewer already never makes.
