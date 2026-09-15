// Strips control and invisible characters from any string returned to a
// caller: the safe provider's open(), and every evidence value/path
// built downstream. These characters can hide or reorder text (an
// "invisible instruction", a right-to-left override that makes a
// filename or comment read differently than it renders, or a raw
// terminal escape sequence) and have no legitimate place in source we
// scan or in a value that might later be printed to a terminal.
//
// Ranges stripped:
//   - C0 controls, U+0000-U+001F, EXCEPT U+0009 (tab) and U+000A (LF),
//     which are kept because they are structurally meaningful in file
//     content (indentation, line splitting). U+000D (CR) IS stripped --
//     downstream line-splitting already matches "\r\n|\r|\n", so
//     removing a bare CR still leaves every LF-based split working, and
//     a lone CR has no other legitimate meaning here. (The character
//     class below is written as two ranges, \x00-\x08 and \x0B-\x1F, so
//     that only \x09/\x0A fall outside it -- \x0D sits inside \x0B-\x1F.)
//   - U+007F (DEL) and the C1 controls, U+0080-U+009F
//   - zero-width characters: U+200B-U+200F (zero-width space/joiners,
//     marks), U+2060-U+2064 (word joiner and invisible operators),
//     U+FEFF (byte-order mark / zero-width no-break space)
//   - bidirectional overrides, U+202A-U+202E, and bidirectional
//     isolates, U+2066-U+2069 (LRI/RLI/FSI/PDI)
const CONTROL_CHARS_RE =
  // eslint-disable-next-line no-control-regex -- the whole point is matching C0/C1 control characters
  /[\x00-\x08\x0B-\x1F\x7F\x80-\x9F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

// A hard sanity cap on how much text this utility will process/return in
// one call, independent of any caller's own size limits (SafeProvider
// already bounds a single file to maxFileBytes, but this module is a
// shared utility other callers may use directly). 4MB is generous for
// any single string this engine legitimately handles.
const MAX_LENGTH = 4 * 1024 * 1024;

function stripControlChars(value) {
  if (typeof value !== 'string') return value;
  const bounded = value.length > MAX_LENGTH ? value.slice(0, MAX_LENGTH) : value;
  return bounded.replace(CONTROL_CHARS_RE, '');
}

module.exports = { stripControlChars, CONTROL_CHARS_RE, MAX_LENGTH };
