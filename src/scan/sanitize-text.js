// Strips control and invisible characters from any string returned to a
// caller: the safe provider's open(), and every evidence value/path
// built downstream. These characters can hide or reorder text (an
// "invisible instruction", a right-to-left override that makes a
// filename or comment read differently than it renders, or a raw
// terminal escape sequence) and have no legitimate place in source we
// scan or in a value that might later be printed to a terminal.
//
// Fix round 2, item 3: the previous version of this file hand-listed
// specific code point ranges (zero-width characters, bidi overrides, the
// C0/C1 control ranges). That style of allow/deny-list reliably misses
// characters nobody thought to add by hand -- this branch's own security
// re-check found U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR),
// U+00AD (SOFT HYPHEN, invisible but can silently split or hyphenate a
// word) and U+061C (ARABIC LETTER MARK, a bidi control) all missing.
// Unicode's own general-category properties are used instead, so the
// class is complete by construction rather than by enumeration:
//   - \p{Cc} (control): every C0 and C1 control character, MINUS U+0009
//     (tab) and U+000A (LF) via the negative lookahead below -- those two
//     are structurally meaningful in file content (indentation, line
//     splitting) and are kept. U+000D (CR) is NOT excluded, so it is
//     still stripped: downstream line-splitting already matches
//     "\r\n|\r|\n", so removing a bare CR still leaves every LF-based
//     split working, and a lone CR has no other legitimate meaning here.
//   - \p{Cf} (format): every zero-width character, bidi override and
//     isolate, the byte-order mark, the soft hyphen, and the Arabic
//     letter mark are ALL format characters -- one property covers every
//     case the previous hand-picked ranges tried to enumerate, plus the
//     ones they missed.
//   - \p{Zl} / \p{Zp} (line/paragraph separator): U+2028 and U+2029,
//     which a naive "\n" line-splitter would not recognise as a line
//     break, but which some renderers treat as one anyway -- a value
//     containing one can visually look like several lines without any
//     of this engine's own newline-aware logic seeing it that way.
const CONTROL_CHARS_RE = /((?!\t|\n)\p{Cc})|\p{Cf}|\p{Zl}|\p{Zp}/gu;

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
