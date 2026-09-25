// Safety rule 4: never follow a symlink out of the install root. This
// repository's own `.agents/skills/<name>` entries ARE symlinks into
// `skills/<name>` (scripts/sync-agent-skills.js), so installing
// `--agent codex --project <this repo>` must refuse each one by name
// rather than write through it into the repository's real `skills/`.

const fs = require('fs');
const path = require('path');

// Returns true when `targetDir` itself, or any existing directory between
// `root` and `targetDir`, is a symlink. `root` is assumed already safe
// (it is a location this package created or the caller's own --project
// directory) and is never itself checked -- only what sits below it.
function symlinkBlocksPath(root, targetDir) {
  const rel = path.relative(root, targetDir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${targetDir}" is not inside "${root}"`);
  }

  const parts = rel.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      // Nothing exists at this level yet, so nothing deeper can exist
      // either -- there is no symlink to find below a path that is not
      // there.
      return false;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

module.exports = { symlinkBlocksPath };
