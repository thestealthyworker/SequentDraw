# nested-worktrees fixture

An outer repository that contains two nested repositories and one decoy.

The repository-boundary markers are NOT committed here: git refuses to track any
path with a `.git` component, so `git add` silently ignores such a file and the
fixture would arrive on disk without the very thing it exists to test. They are
synthesized at test time by `tests/fixtures/build-nested-repo-fixture.js`, which
copies this tree to a temp directory and adds:

| Path | Marker added at build time | Expected verdict |
|---|---|---|
| `.` (the scan root) | `.git` file, `gitdir:` pointer | never skipped -- the root is always a repository |
| `linked-worktree/` | `.git` file, `gitdir:` pointer | skipped, `nested-worktree` |
| `third-party/tool/` | `.git` directory | skipped, `nested-repository` |
| `notes/` | `.git` regular file that is NOT a pointer | kept -- the name alone proves nothing |

`linked-worktree/` is a byte-identical copy of the outer `package.json`, which is
what a real `git worktree add` produces and what made the outer repo's own
components get counted twice (issue #34).

`third-party/` is deliberately not named `vendor`: `SKIP_DIR_NAMES` in
safe-provider.js already skips that name outright, which would hide whether the
`.git`-boundary test works at all.

`stripe` and `twilio` are tripwires: they appear only inside the nested
repositories, so seeing either in the evidence means the walk descended into one.
