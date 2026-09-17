---
name: business-map
description: Map a business idea or process as an interactive SequentDraw map by interviewing the user -- about eight questions tracing one unit of value from "work is needed" to "paid", written as the business and edge layers, with an open question drawn in the map for anything the user cannot answer. Then offers up to five n8n integrations that improve that workflow, as suggested nodes the user accepts or declines. Trigger phrases -- "map how our business takes and fulfils a booking", "map my business", "map our process", "draw our process from enquiry to invoice", "map this idea". Runs inline as a conversation, never as a background agent. NOT for mapping a code repository from a path or a GitHub URL (that is git-map), NOT for reviewing or suggesting integrations for a map that already exists (that is eval-build, or grill-build for a harsh critique), NOT for tool advice with no map, NOT for exporting an existing map as a static image (that is doc-map), NOT for building or deploying an n8n workflow, and NOT a general Mermaid, flowchart or chart tool.
when_to_use: Use when the user wants a map of how their business, service or idea actually works -- who does what, in what order, what the customer gets and how payment or sign-off arrives -- and the answers live in the user's head rather than in code. Also when an existing map needs its business and edge layers filled in by asking. Do not use when a map already exists and the user only wants a picture of it (doc-map) or a review of it (eval-build).
---

# business-map

Turns a conversation into a SequentDraw map of how one unit of work travels
from "work is needed" to "paid". It writes the `business` and `edge` layers,
which no scanner can produce, and it draws what the user does not know
instead of guessing it. Once the map exists it offers up to five n8n
integrations that would improve that workflow, drawn beside the facts.

This skill runs **inline**, in the user's own conversation. It is an
interview: it must be able to ask, hear the answer and ask the next
question. It is never a forked subagent.

## Principle: the map is the questionnaire

The user is an **author** of the map, not a reviewer of it. Never fill a gap
with a plausible answer. "Probably the office manager" is written as an
`open` node with a `prompt`, not as a confirmed `human` node. Anything the
user does not know, or skips, becomes an open question drawn in the map --
and a partly answered map is still a usable artifact.

The engine, not this skill, decides what counts as a gap. Build what the
user actually said, then let `check` find the holes. A suggested
integration is an opinion, never a fact: it is drawn as `suggested` and
only the user can accept it.

## Pipeline

```
user  <---- eight questions, one unit of value ---->  this skill (inline)
  |                                                      |
  |  answers, "I don't know", "skip"                     v
  |                                      map document: business + edge layers,
  |                                      source "user", open nodes for unknowns
  |                                                      |
  |  printf '%s' '<map>' | <sequentdraw> check - --emit-open <folder>/gaps.json
  |  <sequentdraw> check <folder>/gaps.json              |
  |                                                      v
  |  "I can suggest up to five n8n integrations..." -- yes / no
  |     yes: <sequentdraw> catalogue --json, add suggested nodes,
  |          printf '%s' '<map>' | <sequentdraw> check - --emit-open <folder>/suggested.json
  |                                                      v
  |  <sequentdraw> render <folder>/<gaps|suggested>.json <folder>/map.html --fragment
  |                                                      v
  +---- answers, accept / decline, in conversation <--- private artifact + local copy
```

**Read `references/cli-pipeline.md` before the first CLI call.** It says how
`<sequentdraw>` resolves and holds the three command shapes this skill
uses. In short:

- A document reaches the CLI only as
  `printf '%s' '<the whole JSON document>' | <sequentdraw> check - ...`,
  with every apostrophe inside the JSON written as `\u0027`.
- A file the CLI wrote is passed by path: `<sequentdraw> check <file>`,
  `<sequentdraw> render <file> <folder>/map.html --fragment`.
- **Never** a heredoc with the JSON as its body, **never** `mkdir`,
  `touch`, `echo`/`cat` redirects, `tee` or `node -e` to create a file, and
  **never** anything chained before or after the command. The CLI writes
  every file and creates the folder itself: `check - --emit-open` is how a
  document is saved.

Use one session or temp folder outside any repository for everything, for
example `$TMPDIR/sequentdraw-<short-name>/`.

## Steps

1. **Find or start the document.** If a map is already in the conversation,
   or the user names one, **extend that document** -- do not replace it. Its
   existing `open` nodes are the first questions to ask, because they are
   already the map's own record of what nobody knows. Otherwise start an
   empty document and take its `title` from question 1. This skill never
   scans a repository; if the user wants a repository mapped first, that is
   `git-map`.

2. **Interview** -- the eight questions are in `references/interview.md`,
   with what each writes into the map and what an "I don't know" becomes.
   Read that file before asking. Three rules govern the asking:

   - **Never re-ask what the user already told you.** A user who opens with
     the whole story has answered several questions; confirm your reading in
     one message rather than walking the list.
   - **One lifecycle.** One unit of value, not every customer type and not
     every branch. The map that tries to hold everything is the one nobody
     reads.
   - **"I don't know" and "skip" are the same answer**: an open node with a
     prompt naming what is missing. Question 1 is the only one with no
     fallback -- a map with no unit of value has nothing to trace, so say so
     and stop rather than picking one.

3. **Check, save and emit the questions** in one command:

   ```
   printf '%s' '<the whole map document>' | <sequentdraw> check - --emit-open <folder>/gaps.json
   ```

   `check` validates the document first. A structural error prints one
   `path  message` line per problem, exits 1 and writes nothing: fix only
   what the interview wrote and run the same command again.

   Otherwise it writes `gaps.json`, a **copy** carrying one open node per
   gap, and prints `wrote <folder>/gaps.json (<n> open node(s))` plus one
   `path  message` line per gap. **Read those gap lines back to the user in
   plain words** -- "nobody receives the invoice in this map, so I have
   drawn that as a question" -- rather than pasting the raw lines.

   Then re-check the copy:

   ```
   <sequentdraw> check <folder>/gaps.json
   ```

   Usually this prints `ok`, because an open node satisfies the rule that
   emitted it. **One report is expected and is not a failure to retry:**
   `unhappy-paths-missing` on the copy. That gap is answered by a gold
   sticky note, not by a node, so its condition stays true of the copy for
   as long as the map has no `edge`-layer node. If `check` reports **only**
   that, the note is already in the map and the question belongs in the
   conversation, not in another CLI run: tell the user nothing goes wrong
   in their map yet, ask once what does, and carry on with `gaps.json`.
   Never loop on `check` waiting for `ok`. Any *other* report on the copy
   is a real problem -- say what it was and stop rather than papering over
   it.

4. **Offer suggestions, once.** Ask one question: "I can suggest up to five
   n8n integrations that fit this map. Want them?" If the user already
   said -- "and suggest some tools", or "no recommendations, just the map"
   -- do not ask again; do what they said. A user who asked not to be
   asked anything, and did not ask for suggestions, has said no. On
   **no**, skip this step
   entirely: do not read the catalogue, write no suggested node, and render
   `gaps.json` in step 5. The map without suggestions is complete.

   On **yes** -- the rules are in `references/suggestions.md`; read it
   first:

   - Read the pool with `<sequentdraw> catalogue --json`. Never suggest
     from memory; every `integration` is an `id` from that list.
   - Read `<folder>/gaps.json` with the host's file-reading tool, so the
     emitted open nodes (their `q_` ids) are there to cite.
   - Add each suggestion to that document as a node with `id` prefixed
     `s_`, `status: "suggested"`, `source: "model"`, `integration`, a
     `rationale` of at most 500 characters that names its anchor in the
     user's own words, `cites` listing the confirmed or open nodes it
     answers, and at least one edge to its anchor. Target three, at most
     five, and zero is a correct answer when nothing fits.
   - **Workflow improvements only.** Never reason about budget, price,
     cost, financial fit or region; the user decides what fits.
   - Save and check it:

     ```
     printf '%s' '<gaps.json plus the suggestions>' | <sequentdraw> check - --emit-open <folder>/suggested.json
     ```

     A suggestion error names the node's path and writes nothing: fix that
     node and run the same command again. On success it prints
     `wrote <folder>/suggested.json (0 open nodes)`; gap checks ignore
     suggested nodes, so a suggestion never adds or hides a question.
   - Tell the user each suggestion in one line: the product, what it would
     do, and the step or question it answers.

5. **Write the local copy first, then render** the last file you saved --
   `suggested.json` if step 4 added suggestions, otherwise `gaps.json`:

   ```
   <sequentdraw> render <folder>/suggested.json <folder>/map.html --fragment
   ```

   The CLI prints `wrote <path> (<size>kb)` -- keep that output and print
   the folder's paths.

6. **Publish** -- see `references/artifact-output.md`. In Claude Code,
   publish `map.html` as a private Claude artifact, give the user the link
   and say the page is private and is never shared further. Where publishing
   is unavailable (Codex, a CLI-only host, a sandbox with no artifact tool),
   report the local paths instead -- never stop without giving the user
   something on disk. Write into a repository only if the user asks, and ask
   before overwriting anything there.

7. **Answers, accepts and declines are corrections.** When the user answers
   a question, find the `q_`-prefixed open node it belongs to, replace it
   with a confirmed node carrying `source: "user"`, and wire it the way the
   answer describes. When the user accepts a suggestion, drop its `status`,
   `rationale` and `cites`, keep `integration`, and set `source: "user"`;
   when they decline one, remove the node and every edge touching it (see
   `references/suggestions.md`). Then save the edited document with
   `check - --emit-open` into the same folder, re-check it, re-render, and
   republish to the **same** artifact rather than creating a new one.

## What this skill refuses to do

- **Scan a repository.** That is `git-map`. Handed a local path or a GitHub
  URL, say so, and offer to run `git-map` first and then interview against
  its result.
- **Review an existing map** or suggest integrations for one without an
  interview. That is `eval-build` (or `grill-build` for a harsh critique).
- **Export a static figure.** That is `doc-map`.
- **Give tool advice with no map.** Asked "what should I use for
  invoicing" out of the blue, say that SequentDraw suggests integrations
  against a map of how the work actually runs, and offer to map it first.
- **Reason about money or region.** Suggestions are workflow improvements;
  the user decides what fits their budget and market.
- **Build or deploy an n8n workflow**, or draw a general chart or Mermaid
  diagram.
- **Fill a gap with a plausible answer.** Propose wording for the user's own
  answer if it helps; never decide that something exists. A suggestion is
  never written as confirmed.
- **Chase completeness.** Eight questions, one lifecycle, at most three
  unhappy paths unless the user offers more.
- **Run as a fork**, write into a repository unasked, or go looking in a
  codebase for business facts -- there are none there.

## Details

`references/interview.md` holds the eight questions, what each one writes,
and where each kind of node belongs. `references/suggestions.md` holds the
suggestion rules, and `references/cli-pipeline.md` the command shapes.
`references/artifact-output.md` holds the output rule every SequentDraw
skill follows.
