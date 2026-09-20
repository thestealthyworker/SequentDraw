---
type: regex
target: trace
pattern: '(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]+\.json \(\d+ usable, \d+ rejected\)'
match: contains
weight: 2
---

Verification actually ran. `sequentdraw licences` prints exactly one line
when it writes its verdicts:

    wrote /tmp/.../repos.json (2 usable, 3 rejected)

and it is the only command in the product that prints that shape, so this
grader cannot be satisfied by any other step. It matches whatever the
verdicts were: a run where GitHub rate-limited every candidate still prints
`(0 usable, 5 rejected)`, and that is a correct outcome -- the skill then
says it could not verify and attaches nothing. What it cannot be satisfied
by is attaching candidates without verifying them, which is the failure this
whole step exists to prevent.

The skill text describes the command but never writes the output line with
digits in it, so reading the skill cannot satisfy this grader either.
