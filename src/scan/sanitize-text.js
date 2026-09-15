// Strips zero-width and bidirectional control characters from any string
// returned to a caller: the safe provider's open(), and every evidence
// value/path built downstream. These characters can hide or reorder text
// (an "invisible instruction" or a right-to-left override that makes a
// filename or comment read differently than it renders) and have no
// legitimate place in source we scan.
//
// Ranges stripped: U+200B-U+200F (zero-width space/joiners, marks),
// U+202A-U+202E (bidi embedding/override controls), U+2060-U+2064
// (word joiner and invisible operators), U+FEFF (byte-order mark / zero
// width no-break space).
const CONTROL_CHARS_RE = /[​-‏‪-‮⁠-⁤﻿]/g;

function stripControlChars(value) {
  if (typeof value !== 'string') return value;
  return value.replace(CONTROL_CHARS_RE, '');
}

module.exports = { stripControlChars, CONTROL_CHARS_RE };
