// Which skills this package ships, and a one-line summary of each for
// `sequentdraw skills list` and `skills install`'s own iteration -- both
// read this instead of re-deriving it, so the six names are named in one
// place (safety rule 6: only a `skills/<name>/` with a `SKILL.md` is ever
// touched).

const fs = require('fs');
const path = require('path');

function listShippedSkillNames(packageRoot) {
  const skillsDir = path.join(packageRoot, 'skills');
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();
}

// The first sentence of a description: the text up to and including the
// first ". " (or the end, when there is no second sentence). Every
// shipped description's first sentence ends before any other period runs,
// so this is exact for the six skills this package ships -- it is not a
// general-purpose sentence splitter and is not meant to be one.
function firstSentence(text) {
  return text.split(/(?<=\.)\s+/)[0];
}

function skillSummary(packageRoot, name) {
  const skillMdPath = path.join(packageRoot, 'skills', name, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf8');
  const match = content.match(/^description:\s*(.+)$/m);
  if (!match) return '';
  return firstSentence(match[1].trim());
}

module.exports = { listShippedSkillNames, skillSummary, firstSentence };
