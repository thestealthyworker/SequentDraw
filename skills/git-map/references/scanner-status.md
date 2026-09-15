# Scanner status

`sequentdraw scan <path|github-url> --out bundle.json` and
`sequentdraw check --evidence bundle.json` are registered in the CLI (`src/cli/scan.js`,
`src/cli/check.js`) but not yet implemented: both currently print
`available once the scanner is merged` and exit 2.

They are wired up once `src/scan/` (`scanRepo`, `checkEvidence` -- built on
a branch separate from this one) merges to `main`. See
`docs/design/git-map.md` sections 1-3 for the full scan contract this
skill is written against: acquisition rules (local path / GitHub URL
cloning), the safe file provider's guards (size limits, skipped
directories, secret handling, symlinks never followed), the evidence
bundle shape, and the evidence-kind trust ordering.

Until then, if a user invokes `git-map`, say plainly that the scanner is
not merged yet rather than attempting to fabricate a map without evidence
-- that would violate this skill's core rule (evidence, not guesses).
