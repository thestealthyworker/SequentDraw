// Copies one `skills/<name>/` directory to an install target: every file
// byte for byte except `references/cli-pipeline.md`, which is rewritten
// (rewrite-cli-pipeline.js), plus the marker file every installed
// directory carries (marker.js). Safety rule 6 is enforced by the caller
// (src/cli/skills.js), which only ever passes a `sourceDir` under this
// package's own `skills/` for a name that has a `SKILL.md`.

const fs = require('fs');
const path = require('path');
const { rewriteCliPipeline } = require('./rewrite-cli-pipeline');
const { writeMarker } = require('./marker');

const CLI_PIPELINE_REL = path.join('references', 'cli-pipeline.md');

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
  const original = fs.readFileSync(cliPipelinePath, 'utf8');
  const rewritten = rewriteCliPipeline(original, engineInfo);
  fs.writeFileSync(cliPipelinePath, rewritten);

  const { buildEngineCommand } = require('./rewrite-cli-pipeline');
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
