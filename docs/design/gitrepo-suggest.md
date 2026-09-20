# Design: `gitrepo-suggest` (build step 7b)

Written 2026-09-20, after the M2 gate. Implements `docs/HANDOVER.md` step 7b:
for a map's weakest or most custom-built nodes, search GitHub for relevant
MIT-licensed repositories, verify each licence through the GitHub licence API
(SPDX `MIT` exactly), check activity and fit, and attach candidates as sticky notes
linked to the node.

## Decision

Three things are separated, and only the middle one is the engine's:

| Step | Who | Why there |
|---|---|---|
| **Find** candidate repositories | the host AI (`gh search repos`, or the user's own list) | Judging that "a rules engine" is what an unnamed decision node needs is reasoning, not computation. The engine has no business guessing search terms. |
| **Verify** each candidate | the engine, over the GitHub API | A licence is a fact with one right answer. It must be checked the same way every time, on every surface, with no model in the loop. |
| **Attach** the survivors to the map | the host AI, as a `--merge` patch of sticky notes | The note says what the repo is *for this node*, which only the reasoner knows. |

This is the split step 7 already uses for integrations (`docs/design/suggestion-agent.md`):
the host reasons, the engine supplies the constraint and refuses what breaks it.

## Principle: a licence claim is checked, never believed

`git-map` will not let a scan-sourced node into a map without evidence that backs it
(`check --evidence`). A repository recommendation is the same kind of claim, with a
sharper edge: acting on "this is MIT" when it is AGPL-3.0 has consequences for the
user's business that a wrong icon does not.

So the engine gains a verification step with the same shape as the evidence check:

```
sequentdraw licences <owner/repo> [...] --out <verified.json>
sequentdraw check <map.json> --merge <patch.json> --repos <verified.json>
```

`check --repos` refuses any note whose text links to a GitHub repository that is not in
the verified file, or that the verified file marks as anything but usable. A model
cannot talk its way past it, and the CLI and HTTP surfaces get the same refusal.

## 1. Which nodes get candidates

The weakest nodes, in this order, capped at **three nodes per run**:

1. an `open` node that names a missing capability ("Who chases this?"), because nothing
   in the map does that job yet;
2. a `manual` node on the happy path with no `integration`, because it is hand-done work;
3. a `service` node with no `icon` and no `integration`, because nothing identifies what
   is actually running there.

A node that already carries an `integration` is skipped: step 7 has already answered it
from the catalogue, and two answers to one question is noise.

The skill picks. The engine does not rank nodes — a ranking rule in `check` would be a
new judgement, and `src/gaps/completeness.js` deliberately holds none.

## 2. Verification: `sequentdraw licences`

```
sequentdraw licences <owner/repo> [<owner/repo> ...] --out <verified.json>
  [--token-env <NAME>]   environment variable holding a GitHub token (default GITHUB_TOKEN)
  [--max <n>]            refuse more than n repositories in one run (default 15)
```

For each argument the engine calls two GitHub REST endpoints and nothing else:

- `GET /repos/{owner}/{repo}` — `archived`, `pushed_at`, `stargazers_count`, `fork`,
  `default_branch`, `html_url`
- `GET /repos/{owner}/{repo}/license` — `license.spdx_id`

### The licence rule

**`spdx_id === "MIT"`, exactly.** Not `MIT-0`, not `NOASSERTION`, not `Other`, not a
missing licence file, not a dual licence expressed as anything else, and not a licence
the API reports with low confidence. Case-sensitive comparison against the one string.

The GitHub licence API is the source, not the repository's own README, not a `LICENSE`
file read by hand, and not the model's memory of what a project is licensed under.

### The activity and fit rules

Each is a fact the API returns, applied the same way every run:

| Rule | Threshold | Why |
|---|---|---|
| not archived | `archived === false` | an archived repo takes no fixes |
| pushed recently | `pushed_at` within **18 months** | a small business inheriting an abandoned dependency inherits its bugs |
| not a bare fork | `fork === false` | the upstream is the thing to recommend |
| has some standing | `stargazers_count >= 50` | a crude floor, not a quality judgement; it keeps "someone's weekend project" out |

A repository that fails any rule is written to the output with the reason, so the skill
can say *why* a candidate was dropped rather than silently producing fewer.

### The output

```jsonc
{
  "checkedAt": "2026-09-20T09:00:00Z",
  "repos": [
    {
      "id": "owner/repo",
      "url": "https://github.com/owner/repo",
      "usable": true,
      "spdx": "MIT",
      "pushedAt": "2026-07-02T11:04:00Z",
      "stars": 1840,
      "archived": false,
      "fork": false
    },
    {
      "id": "owner/other",
      "url": "https://github.com/owner/other",
      "usable": false,
      "spdx": "AGPL-3.0",
      "reason": "licence-not-mit"
    }
  ]
}
```

`reason` is one of `licence-not-mit`, `licence-unknown`, `archived`, `stale`, `is-fork`,
`too-few-stars`, `not-found`, `rate-limited`, `network-error`. Exit code is 0 when the
file is written, whatever the verdicts; the verdicts are the point, not an error.

## 3. Attaching candidates: the note shape

A candidate is a **sticky note**, not a node. A node would claim the repository is part
of the system; a note says someone could use it. The existing gold "Consider:"
convention already carries exactly this weight.

```jsonc
{
  "id": "n_repo_q_chaser",
  "attachTo": ["q_chaser"],
  "color": "blue",
  "layers": ["base"],
  "content": "**Could fill this gap**\n\n[owner/repo](https://github.com/owner/repo) — MIT, 1.8k stars, last pushed July 2026. Sends a reminder on a schedule and records the reply, which is the job nobody is named for here.\n\nNot a hosted service: someone has to run and update it."
}
```

Rules, enforced by `check --repos`:

- **At most three candidates per node, at most one note per node.** Three links in one
  note, not three notes crowding one place on the canvas.
- **Every GitHub link in the note must be a repository the verified file marks
  `usable: true`.** A link to an unverified or rejected repository is an error.
- **Every note must name its cost.** Not machine-checkable; the skill carries it as a
  rule and the eval grades it. A recommendation that omits "someone has to run this" is
  the kind of advice that costs a small business a weekend.
- The note colour is `blue`, distinct from the gold considerations the review skills
  write, so a reader can see which notes came from where.

### New `check` codes

| Code | When |
|---|---|
| `repo-unverified` | a note links to a GitHub repository absent from `--repos` |
| `repo-not-usable` | a note links to a repository the file marks `usable: false` |
| `repo-too-many` | a note carries more than three repository links |
| `repo-notes-per-node` | more than one repository note attaches to the same node |
| `invalid-repos-file` | `--repos` is not a file of the shape above |

`--repos` is optional. Without it, a map with repository notes is not refused —
`check` cannot know a note is a recommendation — so the **skill** is what always passes
it. The eval asserts the skill does.

## 4. Security

This is the first engine code that talks to an API on the user's behalf, so the rules
are stricter than the scanner's:

- **Two endpoints, one host.** `https://api.github.com` only, path built from a validated
  `owner/repo` (the same charset rules `src/scan/acquire.js` already applies), never from
  user text. No redirects followed to another host, no URL taken from the document.
- **The token is read from an environment variable, never an argument**, never logged,
  never written to the output file. Absent token is fine: the unauthenticated limit is
  60 requests an hour, and `--max 15` needs 30.
- **Nothing is executed and nothing is cloned.** This step reads two JSON documents per
  repository. Cloning is `sequentdraw scan`'s job, and it already does it read-only and
  shallow.
- **Bounded like every other input**: a response over 1MB is refused, every request has
  the same timeout the scanner uses, and the whole run has a wall-clock cap.
- **Rate limiting is reported, never retried in a loop**: on `403` with
  `x-ratelimit-remaining: 0` the repository is marked `rate-limited` with the reset time,
  and the run continues to the next one.
- Offline, the command fails cleanly per repository (`network-error`), and the skill says
  it could not verify rather than attaching unverified links.

## 5. The skill

`gitrepo-suggest`, shipped in the same PR, following the shape the other five share
(`docs/design/skills-and-plugin.md`).

Triggers: "what could I use for this", "find me something open source for the chasing
step", "is there a library that does this". Not for mapping (`git-map`, `business-map`),
not for reviewing (`eval-build`, `grill-build`), not for integrations from the catalogue
(that is step 7 inside `business-map`).

Pipeline:

```
existing map ──► pick up to three weak nodes (the rules in section 1)
                        │
                        ▼
        gh search repos "<terms>" --limit 10   (host AI, per node)
                        │
                        ▼
        sequentdraw licences <owner/repo> ... --out <folder>/repos.json
                        │
                        ▼
        printf '%s' '<patch>' | sequentdraw check <folder>/map.json \
            --merge - --repos <folder>/repos.json --emit-open <folder>/next.json
                        │
                        ▼
        sequentdraw render <folder>/next.json <folder>/map.html --fragment
```

Refusals it carries: never recommend a repository it did not verify in this run; never
more than three per node; never a node that already has an `integration`; never claim a
repository does something the skill has not read in its description; say plainly when a
search returns nothing worth attaching, rather than attaching the best of a bad set.

## 6. Proving it works

Engine tests, offline and deterministic, against recorded API responses (the pattern
`tests/scan-network.test.js` already uses — no live calls in CI):

1. `spdx_id` of `MIT` passes; `MIT-0`, `NOASSERTION`, `Other`, `AGPL-3.0`, a missing
   licence and a missing `license` object each fail with their own reason.
2. archived, stale, fork and low-star repositories each fail with their own reason, and
   a repository failing two rules reports the first in a fixed order.
3. The URL is built only from validated `owner/repo`; hostile owners and repo names
   (`../`, `%2e%2e`, a full URL, an owner over 39 characters) are refused before any
   request.
4. A token is read from the environment, sent as a header, and appears in neither the
   output file nor any error message.
5. `403` with no remaining quota marks `rate-limited` and does not retry.
6. `check --repos` fires each new code, and a map whose notes link only to `usable: true`
   repositories passes.

Skill evals (named here, written in the step 7b PR): a trigger case, a no-trigger case
against a plain integration question, and an output case asserting the run verified
before attaching and that each note names a cost.

## 7. Open questions for the owner

1. **The 50-star floor and the 18-month staleness window** are judgements dressed as
   thresholds. They are deliberately crude; say if either should move, or if stars should
   go entirely in favour of "pushed recently and not archived".
2. **MIT only, as the build order says.** Apache-2.0 and BSD-3-Clause are as permissive
   for a small business's purposes, and excluding them drops good candidates. Widen, or
   keep the rule simple?
3. **Blue notes.** Gold is taken by considerations. Blue is free, but a map with
   business, edge and repository notes starts needing a legend — which is already open
   as issue #56.
