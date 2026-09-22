---
name: gitrepo-suggest
description: Find open-source GitHub projects that could fill the weak spots in an existing SequentDraw map -- a step nobody owns, work still done by hand, a service nothing identifies -- verify each candidate's licence through the GitHub API, and attach the survivors to the map as sticky notes. Trigger phrases -- "what could I use for this", "find me something open source for the chasing step", "is there a library that does this", "what open-source tools would fill these gaps", "find a GitHub project for this part of the map". Verifies before it recommends: every repository it attaches has been checked in that run for an MIT licence, recent activity and a real user base, and anything it could not verify is not attached. NOT for building a map (that is git-map or business-map), NOT for reviewing one (eval-build or grill-build), and NOT for n8n integrations from SequentDraw's own catalogue (business-map already offers those).
when_to_use: Use when a SequentDraw map already exists and the user wants open-source software suggestions for its gaps or its hand-done steps. Do not use to build or change the structure of a map -- this skill only adds notes. Do not use when the user wants a hosted integration from the catalogue.
---

# gitrepo-suggest

Attach verified open-source candidates to the weak nodes of an existing map.

The whole point of this skill is the verification. A recommendation that
turns out to be AGPL-3.0, or abandoned three years ago, has consequences for
a small business that a wrong icon does not. So the engine checks every
repository through GitHub's own API and **refuses the map if a note links to
one that was not verified in this run**. You cannot talk your way past that
refusal, and you should not try: fix the note instead.

## Steps

1. **Find the map.** Use the workflow JSON path the user named, or one
   produced earlier in the conversation. If no map exists, say so and stop
   -- do not build one. Point them at `git-map` (for a repository) or
   `business-map` (for a business or process) and come back afterwards.

2. **Pick at most three nodes.** Read `references/candidates.md` for the
   rules. In short: an `open` node naming a missing capability, then a
   `manual` node on the happy path with no `integration`, then a `service`
   node with no `icon` and no `integration`. Skip any node that already
   carries an `integration` -- `business-map` has already answered that
   question from the catalogue, and two answers to one question is noise.

   Tell the user which nodes you picked and why, before searching.

3. **Search GitHub, per node.** Use the host's own GitHub tooling
   (`gh search repos "<terms>" --limit 10`, or ask the user for candidates
   they already have in mind). Judge relevance from the description the
   search returns -- never from memory of what a project does. Collect at
   most five candidate `owner/repo` ids per node.

   If a search returns nothing that plausibly fits, say so for that node and
   move on. A bad suggestion costs the user more than no suggestion.

   **If you cannot search at all** -- no GitHub tooling, or the host refuses
   it -- say so and stop. Do not fall back on your own memory of which
   projects are popular and permissively licensed: that is a claim about the
   outside world with no verification behind it, which is the one thing this
   skill exists to prevent. The same applies when verification in step 4
   cannot reach GitHub: report it and attach nothing.

4. **Verify every candidate.** Read `references/cli-pipeline.md` before the
   first CLI call: it says how `<sequentdraw>` resolves and which command
   shapes a narrowly granted host accepts. Then, in one call for all the
   candidates across all the nodes:
   ```
   <sequentdraw> licences <owner/repo> <owner/repo> ... --out <folder>/repos.json
   ```
   Write into a folder outside the repository. The command exits 0 whatever
   the verdicts are, prints one line per rejection with its reason, and
   writes a verdict for every candidate. It needs no token; with one, set
   `--token-env` to the variable holding it. Never pass a token as an
   argument, and never print one.

   Read `<folder>/repos.json`. Only entries with `"usable": true` may be
   attached. If nothing survived for a node, say so plainly and name a
   reason from the file -- "the two that fit are both AGPL-3.0" is useful
   to the user; silently attaching fewer notes is not.

5. **Write one note per node.** The shape and the rules are in
   `references/candidates.md`: colour `blue`, attached to that one node, at
   most three repositories, each with what it does *for this node* and what
   it would cost to run. Build them as a `--merge` patch rather than
   re-typing the map:
   ```
   printf '%s' '<patch>' | <sequentdraw> check <folder>/map.json --merge - --repos <folder>/repos.json --emit-open <folder>/next.json
   ```
   `--repos` is not optional for this skill. It is what turns "I verified
   these" from a claim into a fact, and the check refuses the patch if any
   note links to a repository the file does not mark usable.

   Write no apostrophes or backticks inside the patch (`'` only if one
   is unavoidable). If the check refuses the patch, fix the note -- remove
   the unverified link, or split a crowded note -- and re-run. Never work
   around a refusal by removing `--repos`.

6. **Render and hand it over.** Render `next.json`, then follow
   `references/artifact-output.md`: publish a private artifact and also
   write a local copy outside the repository, printing its path. Write into
   the repository only if the user asks.
   ```
   <sequentdraw> render <folder>/next.json <folder>/map.html
   ```

   In your reply, list what you attached and what you rejected, with the
   reason for each rejection. The rejections are the evidence that the
   verification happened.

## Boundaries

- **Never recommends a repository it did not verify in this run.** Not from
  memory, not because it is famous, not because the user asked for it by
  name. Verify it first; if it fails, say why. This holds hardest when
  verification is impossible: "I could not reach GitHub, so I have attached
  nothing" is the right answer, and a list of plausible projects is not.
- **Never states a licence from memory.** The `spdx_id` GitHub's licence API
  returned is the only source. If the engine could not establish one, the
  answer is "I could not verify its licence", never a guess.
- **Never claims a repository does something it has not read.** Describe it
  from its own description; if that is too thin to judge, drop it.
- Never more than three repositories per node, and never more than one
  repository note per node.
- Never changes a node, an edge or a group. This skill adds notes and
  nothing else.
- Not for building a map (`git-map`, `business-map`), not for reviewing one
  (`eval-build`, `grill-build`), not for n8n integrations from the
  catalogue (`business-map` step 7).
- Nothing is cloned and nothing is run. The engine reads two JSON documents
  per repository from `api.github.com` and no other host.
- Says plainly when a search turns up nothing worth attaching, rather than
  attaching the best of a bad set.

## Details

`references/candidates.md` — which nodes qualify, the note shape, and every
refusal the engine will raise with the fix for it.
`references/cli-pipeline.md` — how to call the CLI in any host.
`references/artifact-output.md` — the output rule every SequentDraw skill
follows.
