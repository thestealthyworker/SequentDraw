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

## The command shapes

1. **A change to a map that is already a file: a patch.** This is how every
   finding, suggestion, accept, decline and answer reaches an existing map.
   Never re-type the map itself.

   ```
   printf '%s' '<patch>' | <sequentdraw> check <folder-or-path>/<map>.json --merge - --emit-open <folder>/<name>.json
   ```

   The patch is a small JSON object with any of these keys:

   ```
   {
     "nodes": [ ...nodes to add ],
     "edges": [ ...edges to add ],
     "notes": [ ...notes to add ],
     "remove": {
       "nodes": ["id", ...],
       "edges": [{"from": "id", "to": "id"}, ...],
       "notes": ["id", ...]
     }
   }
   ```

   Removals run first, then additions. Removing a node also removes every
   edge touching it. To change a node, remove it and add it back under the
   same id with its new fields, plus the edges it should keep. An added id
   that is already taken, or a removal of something that is not there, is
   an error and nothing is written. The map file named in the command is
   never modified: `--emit-open` writes the merged result to a new file.

2. **A brand-new map that is not a file yet:** the whole document, once.

   ```
   printf '%s' '<the whole JSON document>' | <sequentdraw> check - --emit-open <folder>/<name>.json
   ```

3. **A file passed by path, and commands with no document:**

   ```
   <sequentdraw> check <folder>/<name>.json
   <sequentdraw> render <folder>/<name>.json <folder>/map.html --fragment
   <sequentdraw> catalogue --json
   ```

## Writing the JSON inside `printf '%s' '...'`

The JSON is one single-quoted shell string, so:

- **Write no apostrophes and no backticks in it.** Reword instead: "the
  owner checks the bank", not "the owner's bank check". A straight
  apostrophe ends the shell string early and the command is refused.
- If an apostrophe truly cannot be avoided, write it as the JSON escape
  `\u0027`, which the CLI reads back as an apostrophe.
- Keep patches small: only what you add or remove.

## What never to do

- **Never re-type an existing map** into a command. Use a patch.
- **Never a heredoc** (`<<'EOF' ... EOF`) with JSON as its body. A narrow
  grant refuses it, even though the same JSON through `printf` is accepted.
- **Never create a file yourself**: no `mkdir`, `touch`, `echo` or `cat`
  with `>`, no `tee`, no `node -e` that writes. The CLI writes every file
  and creates every folder it writes into.
- **Never chain** anything before or after the command: no `cd ... &&`, no
  `;`, no second pipe. One command per call.
- **Never `cat` a file to read it.** Use the host's file-reading tool.

## Where the files go

A session or temp folder outside any repository, for example
`$TMPDIR/sequentdraw-<short-name>/`. Keep every JSON file and the HTML in
that one folder and print their paths. Each save writes a new file name
(`review.json`, then `review-2.json` after a correction), since
`--emit-open` never overwrites the map it reads. Write into a repository
only when the user asks.

## What the CLI prints

- `check` on a clean document prints `ok`.
- `check ... --emit-open <file>` prints `wrote <file> (<n> open node(s))`,
  plus `, <n> note(s)` when it added a note, and one `path  message` line
  per gap it drew. It exits 0 when the file was written, even with gaps.
- A patch that cannot be applied prints `--merge could not apply the
  patch; nothing was written.` and one `path  message` line per problem,
  where the path points into the patch.
- Any structural or suggestion error prints one `path  message` line per
  problem, exits 1 and writes nothing. Fix what it names and run the same
  command again.
- `render` prints `wrote <path> (<size>kb)`.
