# Artifact output rule

This is the rule every SequentDraw skill follows for anything it produces
(map, figure or review): publish a private artifact plus a local copy,
write into the repository only on request.

## In Claude Code

1. Publish the result as a **private Claude artifact**. For `doc-map`
   specifically: publish an HTML page that displays the exported SVG
   inline (an `<img>` or inlined `<svg>` -- whichever keeps the figure
   crisp). The page is private by default; say so, and never share it
   further.
2. **Always** also write a local copy to a temp or session folder outside
   the repository:
   - `doc-map`: the `.svg` file, and the updated `.json` if any node
     descriptions were confirmed and written.
   - Print both paths.
3. Artifact pages cannot offer file downloads. The `.svg` a user actually
   needs for their docs comes from the local copy on disk, not from the
   published page -- the artifact is for *viewing*, the local file is for
   *using*.
4. Write into the repository **only when the user asks** (e.g. "save it
   into our architecture folder"), and **ask before overwriting** anything
   already there.
5. A conversational correction ("make the Payment description shorter")
   edits the local files and republishes to the *same* artifact, rather
   than creating a new one.

## Outside Claude Code (Codex, other agents, CLI-only hosts)

No artifact step. Write the same local files (temp/session folder outside
the repo unless the user asked to save into the repo) and print or open
them directly. There is nothing else to "publish."

## Why this matters

Treating a skill's output like a first-class artifact -- private by
default, with a durable local copy the user can actually use -- means a
user never loses their map because a conversation ended, and never has a
skill silently rewrite files in their repository without asking.
