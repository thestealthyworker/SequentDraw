# Tours

A tour is an ordered walkthrough of the map: a few steps, each spotlighting
one or more nodes with a short narration. The renderer dims everything
outside the spotlight; nothing moves. It is optional, generated on request,
never by default.

## Offer once, never build unasked

After the map is rendered and published -- or its local paths are reported
if publishing is unavailable -- offer a walkthrough in one line: something
like "I can also walk through this map step by step -- want that?" Skip the
offer and build it straight away if the user already asked for a
walkthrough, a tour, or to be "walked through" the map in their request.
If the user declines the offer, or says nothing back, do nothing further:
never build a tour unasked, and never offer twice in one conversation.

## Build it from the map, not from imagination

3-7 steps, in order, that follow:

- the unit of value, from "work is needed" to "paid" (business-map)
- a request's path through the system (git-map)

Every step's `nodeIds` names ids already in the last file the CLI saved --
never an id invented for the tour. Titles are short and plain. Each
description says what happens at that step and why it matters to the
reader, using the map's own words:

- **business-map**: write for a non-technical reader -- what happens and
  why it matters, not how it is implemented.
- **git-map**: technologies may be named, but only ones the map already
  shows; never a claim the scan did not make.

An `open` node may be a step's subject only to say that it is unanswered --
never to answer it.

## Writing the tour

A tour is one merge patch whose only key is `tour`, applied to the map's
last saved file, exactly like a correction (`references/cli-pipeline.md`):

```
printf '%s' '<patch with the whole tour>' | <sequentdraw> check <folder>/<last>.json --merge - --emit-open <folder>/<next>.json
```

The patch:

```
{
  "tour": [
    {
      "order": 1,
      "title": "How a job starts",
      "description": "The main contractor assigns work and the slot is published.",
      "nodeIds": ["mc", "cal", "cust"]
    }
  ]
}
```

Each step carries all four fields, every time:

- `order`: a positive integer, 1-based, unique across the tour.
- `title`: at most 80 characters.
- `description`: at most 500 characters, no apostrophes or backticks
  (reword instead; `'` only if one is truly unavoidable).
- `nodeIds`: at least one id, each one already declared in the map.

`check` enforces unique `order` values and that every `nodeIds` entry names
a declared node; a violation prints one `path  message` line per problem
and writes nothing. Fix the step named and run the same command again. On
success it prints `wrote <folder>/<next>.json (<n> open node(s))`, the same
line a correction prints.

Then re-check the emitted file by path, re-render it, and republish to the
**same** artifact -- a tour is not a new map. Tell the user the map now has
a "Take the tour" button.

## Changing or removing a tour

A tour is replaced whole, never merged step by step, because it is one
ordered narrative (`src/n8n/merge.js`). To change it, send the whole new
tour as the `tour` key again; to remove it, send `"tour": []`. Both go
through the same patch, re-check, re-render, republish steps above.
