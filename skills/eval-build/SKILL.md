---
name: eval-build
description: Review an existing SequentDraw architecture or business map in a balanced way -- what already works, what is missing and what is fragile -- drawn into the map as open questions and gold "Consider:" notes, with up to five n8n integrations suggested as additions for what is missing, plus a short written summary. Trigger phrases -- "review my architecture", "evaluate this build", "what's missing from this map", "is this setup sound", "suggest integrations for this map". Builds the map first with git-map (a repository) or business-map (a business) if none exists. NOT for a harsh critique, stress-test or teardown (that is grill-build, used only when the user asks to grill, tear apart, stress-test or be brutal), NOT for grilling a plan that has no build or map, NOT for general tool advice with no map, NOT for building or deploying an n8n workflow, and NOT for exporting a map as an image (that is doc-map).
when_to_use: Use when a map exists, or the user points at a repository or business to map first, and wants a fair assessment of it or integration ideas for it. Do not use when the user asks for a harsh, brutal or adversarial review -- that is grill-build.
---

# eval-build

A balanced review of a SequentDraw map: what works, what is missing, what
is fragile, in proportion. The findings are drawn into the map itself, next
to the nodes they concern, and up to five n8n integrations are suggested as
additions. A short written summary goes with it.

This skill runs **inline**, in the user's conversation: a review ends with
suggestions the user accepts or declines, and that is a conversation.

## Principle: every finding points at the map

A finding names the node or nodes it is about. "Nothing retries the
payment call when it fails" is a finding; "payments are often fragile" is
not. Where something works, say which node and why -- a review with
nothing positive in it is a grill, and that is `grill-build`'s job.

The engine's gap rules are facts about the map. Everything else in a
review is this skill's judgement, and the summary says which is which.

## Pipeline

```
map file (or a map in the conversation)
  |
  |  <sequentdraw> check <map.json>                 validation + the engine's gap lines
  |  read the map with the host's file-reading tool
  |  <sequentdraw> catalogue --json                 the only source of integrations
  v
a small patch: findings (open nodes, gold notes) + suggested nodes
  |
  |  printf '%s' '<patch>' | <sequentdraw> check <map.json> --merge - --emit-open <folder>/review.json
  |  <sequentdraw> check <folder>/review.json
  |  <sequentdraw> render <folder>/review.json <folder>/map.html --fragment
  v
private artifact + local copy + short written summary
```

**Read `references/cli-pipeline.md` before the first CLI call.** It says how
`<sequentdraw>` resolves and holds the command shapes. In short: **never
re-type the map.** Everything this skill adds or removes goes in as a small
patch against the map file,
`printf '%s' '<patch>' | <sequentdraw> check <map.json> --merge - --emit-open <folder>/review.json`,
and the patch holds only the new nodes, edges and notes and what to
remove. Write **no apostrophes and no backticks** inside the patch; reword
instead (`\u0027` only if one is unavoidable). A file is passed by path.
**Never** a heredoc with JSON as its body, **never** `mkdir`,
`touch`, `echo`/`cat` redirects, `tee` or `node -e` to create a file, and
**never** anything chained before or after the command. The CLI creates
the output folder and writes every file itself. Use one session or temp
folder outside any repository, for example `/tmp/sequentdraw-review/`,
written out as a literal path (never `$TMPDIR`: a variable in an argument
is refused under a narrow grant).

## Steps

1. **Find the map.** Use the map the user names or the one in the
   conversation. If there is none and the user points at a repository, run
   `git-map` first; if the subject is a business or process, offer
   `business-map` first. Never invent structure to have something to
   review. A map that exists only in the conversation is saved first with
   `printf '%s' '<map>' | <sequentdraw> check - --emit-open <folder>/map.json`.

2. **Ask the engine.** `<sequentdraw> check <map.json>`. It prints `ok`, or
   one `path  message` line per gap, or structural errors. Structural
   errors mean the file is not a valid map: say so and stop rather than
   repairing it silently.

   **The gap rules only apply to a map with a `business` layer.** On a
   technical map (every node on `base`, `edge` or `build`, as `git-map`
   writes) the engine prints `ok` whatever the architecture is like. That
   `ok` is not evidence that the build is sound: never cite it as such.
   On such a map every finding is your own judgement, and the summary says
   so.

   **If `check` did not run** -- the CLI was refused, or is unavailable in
   this host -- you do not know what it would have reported. Say only that
   the engine did not run. Make **no** claim about whether its gap rules
   apply to this map or what they would have found, even when the map's
   layers seem to settle it: seeing a `business` layer, or its absence, is
   not the same as knowing what the rules report, and a claim about what
   the engine checks that was never checked is exactly the line between
   engine fact and your judgement that this summary exists to hold.

3. **Read the map** with the host's file-reading tool and review it:

   - **What works**: the parts that hold up, named by node.
   - **What is missing**: a step, owner, recipient, retry or handover the
     map does not show.
   - **What is fragile**: one node everything depends on, a system-to-system
     handover nobody watches, a manual step carrying a lot of volume.

   Draw each finding, as part of the patch, as one of:

   - an **open node** with a `prompt`, when it is a question about the
     user's own system ("Nothing retries the refund call when the payment
     provider fails. Who notices?"), wired to the node it concerns; or
   - a **gold note** whose `content` starts with `Consider:`, `color:
     "gold"`, `attachTo` the node or nodes it concerns, and an `id`
     prefixed `n_review_`, when it is an observation rather than a missing
     piece.

   **Write at most five notes in one review.** A map holds at most 20
   notes in total, including the ones already there; put anything that
   does not fit in the written summary. Do not restate the engine's gap
   lines as notes -- the next step draws those as open questions itself.

4. **Suggest additions** -- read `references/suggestions.md` first. Unless
   the user said not to, add up to five n8n integrations that fill a gap
   or carry a fragile hand step you found: each a `suggested` node with
   `id` prefixed `s_`, `source: "model"`, `integration` from
   `<sequentdraw> catalogue --json` (never from memory), a `rationale` of
   at most 500 characters naming what it answers, `cites` of the node ids
   it answers, and an edge to its anchor. Aim for three; zero is a correct
   answer. **The five include suggestions already in the map**: if the map
   already has four, add at most one, or ask the user which pending one to
   drop.

   **Additions only, never replacements.** Do not propose swapping a tool
   the map already uses; that is `grill-build`. **Workflow improvements
   only**: never reason about budget, price, cost, financial fit or region.

5. **Save and check the reviewed document:**

   ```
   printf '%s' '<patch: your findings and suggestions>' | <sequentdraw> check <map.json> --merge - --emit-open <folder>/review.json
   ```

   The patch has `nodes`, `edges` and `notes` for what you add -- nothing
   from the map itself. `<map.json>` is the file the user named (or the one
   saved in step 1); it is never modified.

   This validates everything you added -- a patch that cannot be applied,
   or a suggestion or note error, names its path and writes nothing, so fix
   that part of the patch and run the same command again -- and draws an open question for every gap the engine still finds. Then
   `<sequentdraw> check <folder>/review.json`. It prints `ok`, or, on a
   business map with no `edge`-layer node, only `unhappy-paths-missing`,
   which is expected: carry on. Never loop on `check` waiting for `ok`.

6. **Render, then publish.**

   ```
   <sequentdraw> render <folder>/review.json <folder>/map.html --fragment
   ```

   Keep its `wrote <path> (<size>kb)` output and print the folder's paths.
   Then publish `map.html` as in `references/artifact-output.md`: a private
   Claude artifact where the host has one, the local paths where it does
   not. If the user named a map file, never overwrite it.

7. **Write the summary**, short:

   - what works, in a line or two;
   - the three most important findings, each naming its node;
   - each suggestion, what it would do and which node or question it
     answers;
   - what the review could not establish: on a map without a `business`
     layer, that the findings are this review's judgement because the
     engine's gap rules do not apply to it;
   - if `check` did not run, that the engine did not run -- and nothing
     about what it would have found.

8. **Accepts, declines and answers are corrections.** Apply them as
   `references/suggestions.md` describes (accept: drop `status`,
   `rationale` and `cites`, keep `integration`, `source: "user"`; decline:
   remove the node and its edges), each as a patch against the last saved
   file (`--merge - --emit-open` to a new file name in the same folder),
   re-check, re-render and republish to the **same** artifact.

## What this skill refuses to do

- **A harsh critique.** "Grill", "tear apart", "stress-test", "be brutal"
  is `grill-build`.
- **Replace a working tool.** Suggestions here are additions.
- **Grill or review a plan with no build or map**, or give tool advice
  with no map. SequentDraw reviews what a map shows.
- **Invent structure**, or claim the engine found the architecture sound.
- **Reason about money or region.** The user decides what fits.
- **Build or deploy an n8n workflow**, or export a figure (`doc-map`).
- **Run as a fork**, or write into a repository unasked.
