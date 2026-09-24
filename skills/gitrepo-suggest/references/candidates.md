# Repository candidates

Which nodes get candidates, what a candidate note looks like, and every
refusal the engine raises with the fix for it.

## Which nodes

At most **three nodes per run**, chosen in this order:

1. **An `open` node that names a missing capability.** "Who chases the
   customer?" is a job nothing in the map does yet, which is exactly where
   software could help.
2. **A `manual` node on the happy path with no `integration`.** Hand-done
   work on the path from "work arrives" to "paid".
3. **A `service` node with no `icon` and no `integration`.** Nothing
   identifies what is actually running there, so there may be something
   better than whatever is.

**Skip a node that already carries an `integration`.** The catalogue has
already answered it.

Fewer than three is fine. Say which you picked and why before searching --
the user may know the third one is not worth solving.

## The note

One note per node, colour `blue`, attached to that node alone.

```jsonc
{
  "id": "n_repo_q_chaser",
  "attachTo": ["q_chaser"],
  "color": "blue",
  "layers": ["base"],
  "content": "**Could fill this gap**\n\n[owner/repo](https://github.com/owner/repo) — MIT, 1.8k stars, last pushed July 2026. Sends a reminder on a schedule and records the reply, which is the job nobody is named for here.\n\nNot a hosted service: someone has to run and update it."
}
```

Blue, because gold is taken by the considerations `eval-build` and
`grill-build` write. A reader can then see at a glance which notes came from
a review and which from a search.

Every note must:

- **say what the repository does *for this node***, not what it is in
  general. "Sends a reminder on a schedule and records the reply, which is
  the job nobody is named for here" — not "a notification library";
- **name its cost.** Someone has to host it, update it, and carry it when it
  breaks. A recommendation that omits that is the kind of advice that costs
  a small business a weekend. This is not machine-checkable, which is
  exactly why it is a rule here;
- **carry the facts the verification produced** — the licence, the star
  count, when it was last pushed — because they are what makes it a
  recommendation rather than a hunch.

## What the engine verifies

`sequentdraw licences` marks a repository `usable` only when **all** of
these hold:

| Rule | Threshold |
|---|---|
| licence | GitHub's licence API reports `spdx_id` of exactly `MIT` |
| not archived | `archived` is false |
| pushed recently | within 18 months |
| not a bare fork | `fork` is false |
| has some standing | at least 50 stars |

Anything else is written to the file with a reason, one of
`licence-not-mit`, `licence-unknown`, `archived`, `stale`, `is-fork`,
`too-few-stars`, `not-found`, `moved`, `auth-failed`, `rate-limited`,
`network-error`, `invalid-id`.

`rate-limited`, `auth-failed` and `network-error` mean *not verified*, not
*rejected*. Say you could not check it, and do not attach it. `auth-failed`
means the token was refused, so say that rather than reporting the
repositories as missing.

## The refusals, and the fix for each

`check --repos` raises these. Each one has one right fix.

| Code | What it means | Fix |
|---|---|---|
| `repo-unverified` | a note links to a repository absent from the `--repos` file | verify it in the same run, or remove the link — never remove `--repos` |
| `repo-not-usable` | the file marks it `usable: false` | drop it and say why, using the reason from the file |
| `repo-too-many` | more than three repositories in one note | keep the three strongest; the rest are noise |
| `repo-notes-per-node` | more than one repository note on one node | merge them into one note |
| `invalid-repos-file` | `--repos` is not a file `sequentdraw licences` wrote | re-run the verification; do not hand-write this file |

## Rate limits

Unauthenticated, GitHub allows 60 requests an hour and this command uses two
per repository. With `--token-env <NAME>` it reads a token from that
environment variable and sends it as a header. Never pass a token as an
argument, never print one, and never put one in the map.

If verification comes back `rate-limited`, report it and stop -- do not
retry in a loop, and do not attach unverified candidates in the meantime.
