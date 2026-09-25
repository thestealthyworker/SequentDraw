// Copies one `skills/<name>/` directory to an install target: every file
// byte for byte except `references/cli-pipeline.md` and `SKILL.md`, which
// are both patched to name the resolved engine command literally instead
// of the plugin-root math a Claude Code plugin checkout would compute
// (rewrite-cli-pipeline.js, patch-skill-md.js), plus the marker file every
// installed directory carries (marker.js). Safety rule 6 is enforced by
// the caller (src/cli/skills.js), which only ever passes a `sourceDir`
// under this package's own `skills/` for a name that has a `SKILL.md`.

const fs = require('fs');
const path = require('path');
const { rewriteCliPipeline, buildEngineCommand } = require('./rewrite-cli-pipeline');
const { patchSkillMd } = require('./patch-skill-md');
const { writeMarker } = require('./marker');

const CLI_PIPELINE_REL = path.join('references', 'cli-pipeline.md');
const SKILL_MD_REL = 'SKILL.md';

function copyTree(sourceDir, targetDir, relDir) {
  const currentSource = path.join(sourceDir, relDir);
  const currentTarget = path.join(targetDir, relDir);
  fs.mkdirSync(currentTarget, { recursive: true });
  for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })) {
    const relPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourceDir, targetDir, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(path.join(sourceDir, relPath), path.join(targetDir, relPath));
    }
    // Every entry under skills/<name>/ in this repository is a plain file
    // or directory (verified by the packaging tests) -- a symlink or any
    // other entry type inside the SOURCE tree is not a case this function
    // needs to handle.
  }
}

// `engineInfo` is `{ isNpx, packageRoot, version }` (runtime.js's shape).
// Returns the engine command string that was written into the marker, so
// the caller can print or record it without recomputing it.
function copySkillDir(sourceDir, targetDir, { engineInfo, name, version }) {
  copyTree(sourceDir, targetDir, '');

  const cliPipelinePath = path.join(targetDir, CLI_PIPELINE_REL);
  const originalCliPipeline = fs.readFileSync(cliPipelinePath, 'utf8');
  fs.writeFileSync(cliPipelinePath, rewriteCliPipeline(originalCliPipeline, engineInfo));

  // SKILL.md is patched too: two of the six skills (git-map, doc-map)
  // restate the same "<plugin root> is two directories above" rule inline,
  // and the model reads SKILL.md before any references/ file -- see
  // patch-skill-md.js for why every copy gets the same override note,
  // whether or not that particular skill happens to restate the rule.
  const skillMdPath = path.join(targetDir, SKILL_MD_REL);
  const originalSkillMd = fs.readFileSync(skillMdPath, 'utf8');
  fs.writeFileSync(skillMdPath, patchSkillMd(originalSkillMd, engineInfo));

  const engine = buildEngineCommand(engineInfo);

  writeMarker(targetDir, {
    package: 'sequentdraw',
    version,
    skill: name,
    engine: engine.command,
  });

  return engine.command;
}

module.exports = { copySkillDir, copyTree, CLI_PIPELINE_REL };
