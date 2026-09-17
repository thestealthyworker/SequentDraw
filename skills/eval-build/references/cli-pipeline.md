# Passing a map to the CLI

The same rules for every SequentDraw skill that writes a map document and
hands it to the engine. They exist because a host may grant the CLI
narrowly -- this plugin's own automated checks grant only `Bash(node:*)` and
no file-writing tool -- and a command outside these forms is refused there.

## Resolving `<sequentdraw>`

- `node "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw"` when `CLAUDE_PLUGIN_ROOT`
  is set (an installed Claude Code plugin).
- When it is not set but this skill was loaded from a plugin checkout,
  `bin/sequentdraw` sits two directories above this skill's own directory:
  use `node "<that directory>/bin/sequentdraw"`. Do not go looking for it.
- Otherwise `npx sequentdraw` (Codex, or any other host).

`scripts/sequentdraw.sh` implements the first and last of these.

## The three command shapes

1. **A document goes in on stdin, from `printf`:**

   ```
   printf '%s' '<the whole JSON document>' | <sequentdraw> check - --emit-open <folder>/<name>.json
   ```

   `-` means "read the document from stdin". The document is one
   single-quoted shell string. Inside it, write every apostrophe as the
   JSON escape `\u0027` (so "owner's" is written `owner\u0027s`); the CLI
   reads it back as an apostrophe. If a command carrying that escape is
   refused, reword the text so it has no apostrophe instead. Nothing else
   inside a single-quoted string needs escaping.

2. **A file the CLI already wrote goes in by path:**

   ```
   <sequentdraw> check <folder>/<name>.json
   <sequentdraw> render <folder>/<name>.json <folder>/map.html --fragment
   ```

3. **No document at all:** `<sequentdraw> catalogue --json`.

## What never to do

- **Never a heredoc** (`<<'EOF' ... EOF`) with the JSON as its body. A
  narrow grant refuses it, even though the same JSON through `printf` is
  accepted.
- **Never create a file yourself**: no `mkdir`, `touch`, `echo` or `cat`
  with `>`, no `tee`, no `node -e` that writes. The CLI writes every file
  and creates every folder it writes into. `check - --emit-open
  <folder>/<name>.json` is how a document gets saved: it checks the
  document, adds an open question for any gap still in it, and writes the
  result.
- **Never chain** anything before or after the command: no `cd ... &&`, no
  `;`, no second pipe. One command per call.
- **Never `cat` a file to read it.** Use the host's file-reading tool.

## Where the files go

A session or temp folder outside any repository, for example
`$TMPDIR/sequentdraw-<short-name>/`. Keep every JSON file and the HTML in
that one folder and print their paths. Write into a repository only when
the user asks.

## What the CLI prints

- `check` on a clean document prints `ok`.
- `check ... --emit-open <file>` prints `wrote <file> (<n> open node(s))`,
  plus `, <n> note(s)` when it added a note, and one `path  message` line
  per gap it drew. It exits 0 when the file was written, even with gaps.
- Any structural or suggestion error prints one `path  message` line per
  problem, exits 1 and writes nothing. Fix what it names and run the same
  command again.
- `render` prints `wrote <path> (<size>kb)`.
