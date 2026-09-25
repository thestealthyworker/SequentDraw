// Patches a copied `SKILL.md` so the model, which reads SKILL.md before
// any `references/` file, does not compute the same
// "<plugin root> is two directories above this skill's own directory"
// math that `git-map/SKILL.md` and `doc-map/SKILL.md` carry inline --
// true only inside a Claude Code plugin checkout, never for a copy this
// command wrote to a host's own skills location. This is a review finding
// on top of the original brief: rewrite-cli-pipeline.js already fixes
// `references/cli-pipeline.md`, but two of the six skills restate the same
// rule in their own SKILL.md, which the model would read first and follow
// instead.
//
// `skills/` itself is never edited -- editing it would re-run every
// skill's own paid evals for a change that is really about installation,
// not about what the skill does. This module only ever touches the COPY.
//
// The fix is generic, not a per-skill find-and-replace: every copied
// SKILL.md gets the same "## Installed copy" block inserted immediately
// after its frontmatter (which stays byte-identical and first in the
// file, since hosts parse it there), telling the model to use the literal
// engine command below and to ignore any conflicting instruction further
// down in the same file -- whether or not that particular skill happens
// to carry one today.

const { buildEngineCommand } = require('./rewrite-cli-pipeline');

// Matches from the start of the file through the closing "---" line of a
// YAML frontmatter block, non-greedy so it stops at the FIRST closing
// fence, not the last "---" anywhere in the file.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

function buildInstalledCopyBlock(engineInfo) {
  const engine = buildEngineCommand(engineInfo);
  const pluginRootLine = engine.kind === 'npx'
    ? 'There is no local `<plugin root>` for this copy: it runs from a temporary `npx` cache. The CLI validates every document itself, so a question about the document shape is answered by running `<sequentdraw> validate` on it, not by reading a schema file at a computed path.'
    : `\`<plugin root>\` -- if this file mentions one below -- is the literal absolute path \`${engineInfo.packageRoot}\`.`;

  return `## Installed copy

This copy of the skill was installed by \`sequentdraw skills install\`, not
loaded from a Claude Code plugin checkout. \`<sequentdraw>\` is exactly this
command, whatever any other instruction in this file computes:

\`\`\`
${engine.command}
\`\`\`

${pluginRootLine} **Ignore any instruction below this block that says to
compute the plugin root from this skill's own base directory, or from "two
directories above" it** -- that math is only for a skill still living
inside a Claude Code plugin, and this copy is not one.
`;
}

// Returns the copy's content with the block inserted right after the
// frontmatter. Throws if `content` has no recognizable frontmatter --
// every shipped SKILL.md has one, so that would mean this ran against the
// wrong kind of file.
function patchSkillMd(content, engineInfo) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) throw new Error('SKILL.md has no recognizable frontmatter to patch after');
  const frontmatter = match[0];
  const rest = content.slice(frontmatter.length);
  return frontmatter + '\n' + buildInstalledCopyBlock(engineInfo) + rest;
}

module.exports = { patchSkillMd, buildInstalledCopyBlock, FRONTMATTER_RE };
