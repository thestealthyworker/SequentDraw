// The marker every directory this package installs carries, and the
// three-way status check that decides whether install/uninstall may touch
// a given target directory (safety rules 2 and 3 in the brief): a
// directory this package did not mark is never touched, whatever else is
// true about it.

const fs = require('fs');
const path = require('path');

const MARKER_FILENAME = '.sequentdraw-install.json';

function markerPath(dir) {
  return path.join(dir, MARKER_FILENAME);
}

// 'absent'  -- nothing exists at `dir` yet; safe to create.
// 'ours'    -- `dir` exists, is a directory, and carries a valid marker
//              this package wrote; safe to replace.
// 'foreign' -- `dir` exists but is not one of the above: a plain file, a
//              directory with no marker, or one with a marker we cannot
//              parse or that names a different package. Never touched.
//
// Uses `lstatSync`, never `statSync`: a symlink at `dir` must read as
// "something is there", not be followed into whatever it points at.
// (The separate symlink-guard.js check runs first in every caller and is
// what actually refuses a symlinked path -- this function only needs to
// avoid silently following one itself.)
function markerStatus(dir) {
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return 'absent';
  }
  if (!stat.isDirectory()) return 'foreign';

  let raw;
  try {
    raw = fs.readFileSync(markerPath(dir), 'utf8');
  } catch {
    return 'foreign';
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.package === 'sequentdraw' ? 'ours' : 'foreign';
  } catch {
    return 'foreign';
  }
}

function writeMarker(dir, data) {
  fs.writeFileSync(markerPath(dir), `${JSON.stringify(data, null, 2)}\n`);
}

module.exports = { MARKER_FILENAME, markerPath, markerStatus, writeMarker };
