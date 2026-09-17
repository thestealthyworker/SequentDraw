# Artifact output rule

The same rule every SequentDraw skill follows: publish a private artifact
plus a local copy, write into the repository only on request.

## In Claude Code

1. Render with the fragment mode (`sequentdraw render <map>.json map.html
   --fragment`, from the JSON file the CLI saved -- see
   `references/cli-pipeline.md`) and publish it as a **private Claude
   artifact**. Give the user the link. Say the page is private by default
   and is never shared further.
2. **Always** also keep `map.html` in a session or temp folder outside the
   repository, with the JSON files the CLI saved beside it, and print the
   paths. The CLI writes all of them (`check - --emit-open` saves a
   document); never create a file through a shell string.
3. Write into the repository **only when the user asks**
   ("save it into our architecture folder"), and **ask before overwriting**
   anything already there.
4. A conversational correction ("the quote goes out before scheduling")
   edits the JSON, saves and re-checks it, re-renders, and republishes to
   the *same* artifact -- never a new one.

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
