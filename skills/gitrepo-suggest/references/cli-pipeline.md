# Passing a map to the CLI

The same rules for every SequentDraw skill that hands a map, a patch or a
repository to the engine. They exist because a host may grant the CLI
narrowly -- this plugin's own automated checks grant only `Bash(node:*)` and
no file-writing tool -- and a command outside these forms is refused there.

## Resolving `<sequentdraw>`

`<sequentdraw>` is `node <plugin root>/bin/sequentdraw` with the plugin root
**written out as a literal absolute path**. The plugin root is two directories
above this skill's own directory: when the skill loads, the host says "Base
directory for this skill: /some/path/skills/<skill>", so the command is
`node /some/path/bin/sequentdraw`. Do not go looking for it. If that path
contains a space, put it in double quotes: `node "/some path/bin/sequentdraw"`.

- **Never put a variable anywhere in the command**: not
  `${CLAUDE_PLUGIN_ROOT}`, not `$CLAUDE_PLUGIN_ROOT`, and not `$TMPDIR` in
  an output path. A narrow grant cannot see through the expansion and
  refuses the command, even `--version`. This applies to every argument,
  not only the program path: an unquoted `$TMPDIR` can word-split into
  several arguments, so the grant cannot tell what the command would
  actually run. Write the folder out as a literal absolute path instead --
  `/tmp/sequentdraw-<short-name>/` on macOS and Linux.
- **Never** go through `bash scripts/sequentdraw.sh`, and never start with
  `cd ... &&`. Both are refused under a narrow grant.
- **A refused command means that command form was refused, not that the
  shell is unavailable.** Commands such as `ls`, `pwd`, `cd`, `echo`, `env`
  or `find` may be refused while `node <plugin root>/bin/sequentdraw ...` is
  allowed. Never probe with them. If a CLI call is refused, retry it once in
  exactly the shapes below with the literal absolute path before concluding
  anything.
- **If the CLI still cannot run, say so, and claim nothing it would have
  said.** Report that the engine did not run. Never state what `check`,
  `scan` or `render` would have found or produced, from the map's contents
  or from anything else: an engine result that was never computed is not a
  fact, and presenting it as one is worse than saying it is missing.
- Look for files with the host's file tools (Read, and Glob inside the
  working directory), never with shell commands.
- Only when no base directory is known (Codex, or any other host without a
  plugin checkout) use `npx sequentdraw`.

## Learning the document shape

The fields a map may carry (node `kind`, `status`, `source`, `evidence`,
edge `type`, notes, groups, their limits) are defined in
`<plugin root>/schema/sequentdraw.schema.json`. Read that file with the
host's file-reading tool when a field is unclear. **Never probe the CLI with
trial documents** to discover the schema: every trial is a wasted call, and
the schema already answers the question.

## The command shapes

1. **A change to a map that is already a file: a patch.** This is how every
   finding, suggestion, accept, decline, correction and answer reaches an
   existing map. Never re-type the map itself.

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
   <sequentdraw> render <path>/<name>.json <folder>/map.svg --layers <layers>
   <sequentdraw> catalogue --json
   <sequentdraw> scan <repository path or GitHub URL> --out <folder>/bundle.json
   ```

4. **Flags that combine with these shapes.** `--evidence <folder>/bundle.json`
   (a map built from a `scan`) goes on any `check` above, piped or by path:
   `printf '%s' '<map>' | <sequentdraw> check - --evidence <folder>/bundle.json --emit-open <folder>/map.json`.
   `render` takes a patch too, when a change belongs in the picture only and
   the map file must stay as it is:
   `printf '%s' '<patch>' | <sequentdraw> render <path>/<name>.json <folder>/map.svg --merge -`.

## Writing the JSON inside `printf '%s' '...'`

The JSON is one single-quoted shell string, so:

- **Write no apostrophes and no backticks in it.** Reword instead: "the
  owner checks the bank", not "the owner's bank check". A straight
  apostrophe ends the shell string early and the command is refused.
- If an apostrophe truly cannot be avoided, write it as the JSON escape
  `'`, which the CLI reads back as an apostrophe.
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

A session or temp folder outside any repository, written out as a literal
absolute path -- for example `/tmp/sequentdraw-<short-name>/`. **Not
`$TMPDIR/...`**: a variable in an argument is refused under a narrow grant
exactly as one in the program path is, and an unquoted one can word-split
into several arguments. Keep every JSON file and the HTML in that one
folder and print their paths. Each save writes a new file name
(`review.json`, then `review-2.json` after a correction), since
`--emit-open` never overwrites the map it reads. Write into a repository
only when the user asks.

## What the CLI prints

- `scan` prints `wrote <file> (<n> evidence entries)`.
- `check` on a clean document prints `ok`.
- `check ... --emit-open <file>` prints `wrote <file> (<n> open node(s))`,
  plus `, <n> note(s)` when it added a note, and one `path  message` line
  per gap it drew. It exits 0 when the file was written, even with gaps.
- A patch that cannot be applied prints `--merge could not apply the
  patch; nothing was written.` and one `path  message` line per problem,
  where the path points into the patch.
- Any structural, evidence or suggestion error prints one `path  message`
  line per problem, exits 1 and writes nothing. Fix what it names and run
  the same command again.
- `render` prints `wrote <path> (<size>kb)`.
