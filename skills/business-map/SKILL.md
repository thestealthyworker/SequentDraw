---
name: business-map
description: Map a business idea or process as an interactive SequentDraw map by interviewing the user -- about eight questions tracing one unit of value from "work is needed" to "paid", written as the business and edge layers, with an open question drawn in the map for anything the user cannot answer. Trigger phrases -- "map how our business takes and fulfils a booking", "map my business", "map our process", "draw our process from enquiry to invoice", "map this idea", "map how a job gets done and paid for". Runs inline as a conversation with the user, never as a background agent. NOT for mapping a code repository from a path or a GitHub URL (that is git-map), NOT for exporting an existing map as a static image (that is doc-map), NOT for recommending tools or integrations (not shipped yet), NOT for building or deploying an n8n workflow, and NOT a general Mermaid, flowchart or chart tool.
when_to_use: Use when the user wants a map of how their business, service or idea actually works -- who does what, in what order, what the customer gets and how payment or sign-off arrives -- and the answers live in the user's head rather than in code. Use it too when an existing map needs its business and edge layers filled in by asking the user. Do not use when a map already exists and the user only wants a picture of it -- that is doc-map.
---

# business-map

Turns a conversation into a SequentDraw map of how one unit of work travels
from "work is needed" to "paid". It writes the `business` and `edge` layers,
which no scanner can produce, and it draws what the user does not know
instead of guessing it.

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
user actually said, then let `check` find the holes.

## Pipeline

```
user  <---- eight questions, one unit of value ---->  this skill (inline)
  |                                                      |
  |  answers, "I don't know", "skip"                     v
  |                                       map.json: business + edge layers,
  |                                       source "user", open nodes for unknowns
  |                                                      |
  |   <sequentdraw> check map.json --emit-open gaps.json |
  |                                                      v
  |   <sequentdraw> render gaps.json map.html --fragment
  |                                                      v
  +---- answers to open nodes, in conversation <--- private artifact + local copy
```

`<sequentdraw>` means `node "${CLAUDE_PLUGIN_ROOT}/bin/sequentdraw" ...`
when that variable is set (an installed Claude Code plugin), falling back to
`npx sequentdraw ...` when it is not (Codex, or any other host) --
`scripts/sequentdraw.sh` implements exactly that resolution; use it, or the
same fallback logic, rather than hardcoding either form.

`check` and `render` also accept `-` as the input document and read it from
stdin through a quoted heredoc (`<<'EOF' ... EOF`), so a map never has to
touch disk before it is checked. `--emit-open` writes a real file, so this
skill's own pipeline uses real files for both: `map.json` in, `gaps.json`
out, both in a session or temp folder outside any repository. Never create
either through `echo`, `cat` or `node -e`; write them with the host's
file-writing tool, or pipe the document in with `-`.

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

3. **Validate.** `<sequentdraw> validate map.json`. Fix only what the
   interview wrote.

4. **Check and emit the questions.**

   ```
   <sequentdraw> check map.json --emit-open gaps.json
   ```

   This writes a **copy** carrying one open node per gap; `map.json` itself
   is never modified. It prints `wrote gaps.json (<n> open node(s))` and one
   `path  message` line per gap. **Read those gap lines back to the user in
   plain words** -- "nobody receives the invoice in this map, so I have
   drawn that as a question" -- rather than pasting the raw lines.

   Then re-check the copy:

   ```
   <sequentdraw> check gaps.json
   ```

   Usually this prints `ok`, because an open node satisfies the rule that
   emitted it. **One report is expected and is not a failure to retry:**
   `unhappy-paths-missing` on the copy. That gap is answered by a gold
   sticky note, not by a node, so its condition stays true of the copy for
   as long as the map has no `edge`-layer node. If `check gaps.json` reports
   **only** `unhappy-paths-missing`, the note is already in the map and the
   question belongs in the conversation, not in another CLI run: tell the
   user nothing goes wrong in their map yet, ask once what does, and carry
   on with `gaps.json`. Never loop on `check` waiting for `ok`. Any *other*
   report on the copy is a real problem -- say what it was and stop rather
   than papering over it.

5. **Write the local copy first, then render.**

   ```
   <sequentdraw> render gaps.json <folder>/map.html --fragment
   ```

   Render into a session or temp folder outside any repository; the CLI
   creates the output directory itself, so do not make it first. Keep
   `map.json` and `gaps.json` beside the HTML and print all the paths. The
   CLI prints `wrote <path> (<size>kb)` -- keep that output.

   Run each CLI call as **its own command beginning with `<sequentdraw>`**,
   never chained behind `mkdir ... &&`, `echo ... |` or any other prefix: a
   host may grant the CLI narrowly (this plugin's own CI grants
   `Bash(node:*)`), and such a grant matches only a command that *starts*
   with what was granted.

6. **Publish** -- see `references/artifact-output.md`. In Claude Code,
   publish `map.html` as a private Claude artifact, give the user the link
   and say the page is private and is never shared further. Where publishing
   is unavailable (Codex, a CLI-only host, a sandbox with no artifact tool),
   report the local paths instead -- never stop without giving the user
   something on disk. Write into a repository only if the user asks, and ask
   before overwriting anything there.

7. **Answers are corrections.** When the user answers a question, find the
   `q_`-prefixed open node it belongs to, replace it with a confirmed node
   carrying `source: "user"`, wire it the way the answer describes, then
   re-run steps 3 to 5 and republish to the **same** artifact rather than
   creating a new one.

## What this skill refuses to do

- **Scan a repository.** That is `git-map`. Handed a local path or a GitHub
  URL, say so, and offer to run `git-map` first and then interview against
  its result.
- **Export a static figure.** That is `doc-map`.
- **Suggest tools or integrations.** Not shipped yet. Asked "what should I
  use for invoicing", answer that this skill maps what exists and marks the
  gap, and that recommendations are coming.
- **Build or deploy an n8n workflow**, draw a general chart or Mermaid
  diagram, or review or grill a plan.
- **Fill a gap with a plausible answer.** Propose wording for the user's own
  answer if it helps; never decide that something exists.
- **Chase completeness.** Eight questions, one lifecycle, at most three
  unhappy paths unless the user offers more.
- **Run as a fork**, write into a repository unasked, or go looking in a
  codebase for business facts -- there are none there.

## Details

`references/interview.md` holds the eight questions, what each one writes,
and where each kind of node belongs. `references/artifact-output.md` holds
the output rule every SequentDraw skill follows.
