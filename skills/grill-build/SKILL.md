---
name: grill-build
description: Harshly critique an existing SequentDraw architecture or business map and propose stronger alternatives -- every tool choice challenged on lock-in, single points of failure, scaling, operational burden and whether the business needs an automation platform at all, each challenge anchored to a node and drawn into the map, with alternatives from the n8n integration catalogue drawn beside what they would replace and their trade-offs stated. Use ONLY when the user explicitly asks to grill, stress-test, tear apart, roast or brutally review their build, stack, architecture or map -- "grill my architecture", "tear this build apart", "stress-test this stack", "be brutal". Builds the map first with git-map or business-map if none exists. NOT for a balanced review, "review my architecture", "what's missing" or "suggest integrations for this map" (that is eval-build), NOT for grilling a plan, idea or decision that has no build or map (not SequentDraw's job), NOT for general tool advice with no map, NOT for building or deploying an n8n workflow, and NOT for exporting a map as an image (that is doc-map).
when_to_use: Use only when the request itself asks for harshness -- grill, brutal, tear apart, stress-test, roast, don't go easy -- about a build, stack or map. Any other review request goes to eval-build.
---

# grill-build

An adversarial review of a SequentDraw map, for a user who asked for one.
It challenges every tool choice, draws each challenge next to the node it
is about, and proposes stronger alternatives beside what they would
replace, each with its trade-off. A short written verdict goes with it.

This skill runs **inline**, in the user's conversation: alternatives are
suggestions the user accepts or declines.

## Principle: harsh means specific, never louder

A challenge names a node and a concrete failure: "Postgres is the only
store and every module writes to it; when it is down, returns, refunds and
notifications all stop." That is harsh. "This will never scale" is not a
challenge, it is noise, and it fails the same grounding rule as "most teams
use X". No insults, no capital letters, no exclamation marks: the weight
comes from how exactly the weakness is pinned down.

## The five axes

Challenge every tool and every hand step the map shows on:

1. **Lock-in** -- what it would take to leave this tool, and what the map
   has built around it.
2. **Single points of failure** -- the node that, when it is down, stops
   everything downstream of it.
3. **Scaling** -- the step that breaks first when volume grows, judged from
   what the map shows (a manual step on the main path, a synchronous chain).
4. **Operational burden** -- what someone has to run, watch, patch or
   re-key by hand to keep this working.
5. **Whether the business needs an automation platform at all.** Every
   alternative this skill can offer is an n8n integration, so a grill that
   never asks this is not harsh. If a few hand steps would serve the
   business better than any automation, say so in a note.

**Never price, cost, budget, financial fit or region.** Those are the
user's call, and this skill has no data for them. A challenge about
spending is not made.

## Pipeline

```
map file (or a map in the conversation)
  |
  |  <sequentdraw> check <map.json>                 validation + the engine's gap lines
  |  read the map with the host's file-reading tool
  |  <sequentdraw> catalogue --json                 the only source of alternatives
  v
map + challenges (gold notes, open nodes) + alternatives (suggested nodes)
  |
  |  printf '%s' '<the grilled document>' | <sequentdraw> check - --emit-open <folder>/grill.json
  |  <sequentdraw> check <folder>/grill.json
  |  <sequentdraw> render <folder>/grill.json <folder>/map.html --fragment
  v
private artifact + local copy + short written verdict
```

**Read `references/cli-pipeline.md` before the first CLI call.** It says how
`<sequentdraw>` resolves and holds the three command shapes. In short: a
document reaches the CLI only as
`printf '%s' '<the whole JSON document>' | <sequentdraw> check - ...`, with
every apostrophe inside the JSON written as `\u0027`; a file is passed by
path. **Never** a heredoc with the JSON as its body, **never** `mkdir`,
`touch`, `echo`/`cat` redirects, `tee` or `node -e` to create a file, and
**never** anything chained before or after the command. The CLI creates
the output folder and writes every file itself. Use one session or temp
folder outside any repository, for example `$TMPDIR/sequentdraw-grill/`.

## Steps

1. **Find the map.** Use the map the user names or the one in the
   conversation. If there is none and the user points at a repository, run
   `git-map` first; if the subject is a business or process, offer
   `business-map` first. Never invent structure to have something to
   attack. A map that exists only in the conversation is saved first with
   `printf '%s' '<map>' | <sequentdraw> check - --emit-open <folder>/map.json`.

2. **Ask the engine.** `<sequentdraw> check <map.json>`. It prints `ok`, or
   one `path  message` line per gap, or structural errors (say so and
   stop). **The gap rules only apply to a map with a `business` layer.** On
   a technical map the engine prints `ok` whatever the architecture is
   like: never cite that as evidence the build holds up. Every challenge on
   such a map is your own judgement, and the verdict says so.

3. **Read the map** and grill it on the five axes. Draw each challenge as:

   - a **gold note** whose `content` starts with `Consider:`, `color:
     "gold"`, `attachTo` the node or nodes it is about, and an `id`
     prefixed `n_grill_`; or
   - an **open node** with a `prompt`, when the challenge is a question
     only the user can answer ("When the payment provider is down, who
     refunds the customer?"), wired to the node it concerns.

   **Write at most five notes in one grill**, alternatives' trade-off
   notes included. A map holds at most 20 notes in total, including the
   ones already there; the rest of the challenges go in the written
   verdict, ranked.

4. **Propose stronger alternatives** -- read `references/suggestions.md`
   first; every rule there applies. An alternative is drawn as:

   - a `suggested` node (`id` prefixed `s_`, `source: "model"`,
     `integration` from `<sequentdraw> catalogue --json`, never from
     memory) whose `cites` names **the node it would replace**, and whose
     `rationale` says which challenge it answers;
   - wired **beside** that node: a dashed edge between the replaced node
     and the alternative;
   - plus **one gold note**, `attachTo` both the replaced node and the
     alternative, `id` prefixed `n_grill_`, stating the trade-off in both
     directions: "Consider: <alternative> in place of <node>. It removes
     <the weakness>; it gives up <what gets harder or is lost>."

   There is no field that says "replaces": the cite, the edge and the note
   carry it. At most five suggested nodes in the whole document, counting
   any already there. Fewer, stronger alternatives beat a list of swaps --
   fifteen swaps is popularity, not a critique. When the honest answer is
   that the business needs no automation here, propose nothing and say so.

5. **Save and check the grilled document:**

   ```
   printf '%s' '<the map plus your challenges and alternatives>' | <sequentdraw> check - --emit-open <folder>/grill.json
   ```

   A suggestion or note error names its path and writes nothing: fix it
   and run the same command again. Then
   `<sequentdraw> check <folder>/grill.json`. It prints `ok`, or, on a
   business map with no `edge`-layer node, only `unhappy-paths-missing`,
   which is expected: carry on. Never loop on `check` waiting for `ok`.

6. **Render, then publish.**

   ```
   <sequentdraw> render <folder>/grill.json <folder>/map.html --fragment
   ```

   Keep its `wrote <path> (<size>kb)` output and print the folder's paths.
   Then publish `map.html` as in `references/artifact-output.md`: a private
   Claude artifact where the host has one, the local paths where it does
   not. If the user named a map file, never overwrite it.

7. **Write the verdict**, short and ranked:

   - the challenges, worst first, each naming its node and axis;
   - each alternative, what it replaces and its trade-off;
   - what, if anything, genuinely holds up -- only if it does;
   - on a map without a `business` layer, that every challenge is this
     skill's judgement because the engine's gap rules do not apply to it.

8. **Accepting an alternative is two changes**, and ask about both in one
   message: accept the suggested node (drop `status`, `rationale` and
   `cites`, keep `integration`, `source: "user"`), then remove the node it
   replaces and move that node's edges to the new one. Declining removes
   the suggested node, its edges and its trade-off note. Save with
   `check - --emit-open` into the same folder, re-check, re-render and
   republish to the **same** artifact.

## What this skill refuses to do

- **Fire without an explicit ask for harshness.** "Review my architecture"
  is `eval-build`.
- **Grill a plan, idea or decision with no build or map.** That is not
  SequentDraw's job.
- **Generic or loud criticism.** Every challenge names a node.
- **Price, cost, budget or region.** Never an axis.
- **Suggest from memory**, or suggest more than five.
- **Invent structure**, or claim the engine found the architecture sound.
- **Build or deploy an n8n workflow**, or export a figure (`doc-map`).
- **Run as a fork**, or write into a repository unasked.
