// Reconstructed: the prototype's icons.js was not recovered from the web session.
// Glyph paths are lifted from the prototype's rendered Medusa output, so they match
// what the original produced.
//
// Brand icons come from Simple Icons (https://github.com/simple-icons/simple-icons).

const simpleIcons = require('simple-icons');

let bySlug = null;

function index() {
  if (bySlug) return bySlug;
  bySlug = new Map();
  Object.values(simpleIcons).forEach(icon => {
    if (icon && icon.slug && icon.path) bySlug.set(icon.slug, icon);
  });
  return bySlug;
}

// Resolved slug -> { path, hex }. Unknown slug -> null, so the caller falls back to
// the kind glyph instead of guessing a brand.
function get(slug) {
  const icon = index().get(String(slug).toLowerCase());
  return icon ? { path: icon.path, hex: '#' + icon.hex } : null;
}

// One 24x24 stroke glyph per node kind, used when no brand icon resolves.
const glyph = {
  service: 'M4 6h16v5H4zM4 13h16v5H4zM7 8.5h.01M7 15.5h.01',
  human: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14z',
  external: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3v12M6 12h12',
  manual: 'M5 5h14v14H5zM9 9h6v6H9z',
  artifact: 'M6 2h8l4 4v16H6V2zm8 0v5h5',
  logic: 'M12 3l9 9-9 9-9-9 9-9z'
};

module.exports = { get, glyph };
