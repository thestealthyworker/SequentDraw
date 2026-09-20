---
type: regex
target: trace
pattern: 'bin/sequentdraw(?:\\")?\s+check(?=\s)(?:[^"\\]|\\.){0,600}?\s--repos[\s=]'
match: contains
weight: 2
---

The engine, not the model, is what confirmed the notes only link to verified
repositories. `--repos` is what turns "I verified these" from a claim into a
fact: the check refuses the document if any note links to a repository the
verified file does not mark usable, and no wording in the reply can stand in
for it.

The pattern needs `bin/sequentdraw check` and `--repos` inside one Bash
command string, the same shape the git-map output case uses for
`check --evidence`. A run that verified candidates and then attached nothing
(because none survived) has nothing to check and legitimately fails this
grader -- which is why it carries weight beside the judge grader rather than
being the only signal.
