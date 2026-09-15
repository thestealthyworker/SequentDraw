// Small, dependency-free Markdown-subset renderer + word-wrap for sticky
// notes. See docs/design/n8n-visual-style.md "Notes (text boxes)":
// `#`/`##` headings, `**bold**`, `*italic*`, `` `code` ``, `- ` bullet
// lists, line breaks, and `[text](url)` links (http/https/mailto only).
//
// Security model: escape ALL HTML first (per raw line, before any markdown
// syntax is recognised), then apply markdown to the escaped text. Markdown
// syntax characters (# * ` [ ] ( )) are not in the escape set, so they
// survive escaping intact for the regexes below, while `<`, `>`, `&`, `"`
// and `'` never reach the output as anything but entities. Everything this
// module returns (run.text, run.href) is therefore ALREADY escaped —
// callers must not escape it again, or entities would double-escape and
// show up literally (e.g. "&amp;") in the rendered note.

const {
  NOTE_FONT_SIZE,
  NOTE_LINE_HEIGHT,
  NOTE_H1_SIZE,
  NOTE_H1_LINE_HEIGHT,
  NOTE_H2_SIZE,
  NOTE_H2_LINE_HEIGHT,
  NOTE_BULLET_INDENT,
  NOTE_BLANK_GAP,
} = require('./constants');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only these three, case-insensitive, after trimming — everything else
// (javascript:, data:, vbscript:, protocol-relative //, a bare space
// before the scheme) degrades the link to plain text. See "hostile
// content" in tests/n8n-notes.test.js.
const ALLOWED_LINK_PROTOCOLS = /^(https?|mailto):/i;

// The URL has already been HTML-escaped, so a quote or angle bracket shows up
// as an entity. A link whose URL contains whitespace, a quote or an angle
// bracket is not a real address, and it renders as plain text rather than
// being carried into an href. `&amp;` stays allowed for query strings.
const UNSAFE_URL_CONTENT = /\s|&quot;|&#39;|&lt;|&gt;/i;

// Returns the href to use, or null when the link should render as plain text.
// Note content is untrusted, so a mailto link keeps only the address: query
// parameters (cc, bcc, subject, body) would let a note silently add recipients
// to an email the reader composes.
function safeHref(rawUrl) {
  const url = rawUrl.trim();
  if (!ALLOWED_LINK_PROTOCOLS.test(url) || UNSAFE_URL_CONTENT.test(url)) return null;
  if (/^mailto:/i.test(url)) return url.split('?')[0];
  return url;
}

// Tries, at each scan position, code / link / bold / italic in that order,
// so (for example) an asterisk inside a code span is never re-read as
// italic — the code branch already consumed the whole span. No nesting
// support beyond that: not required by the spec's subset.
const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)]*)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function parseInline(escapedText) {
  const runs = [];
  let lastIndex = 0;
  let match;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(escapedText))) {
    if (match.index > lastIndex) {
      runs.push({ text: escapedText.slice(lastIndex, match.index) });
    }
    const [, code, linkText, linkUrl, bold, italic] = match;
    if (code != null) {
      runs.push({ text: code, code: true });
    } else if (linkText != null) {
      const href = safeHref(linkUrl);
      // A rejected URL keeps its visible label and drops the link.
      runs.push(href ? { text: linkText, href } : { text: linkText });
    } else if (bold != null) {
      runs.push({ text: bold, bold: true });
    } else if (italic != null) {
      runs.push({ text: italic, italic: true });
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < escapedText.length) {
    runs.push({ text: escapedText.slice(lastIndex) });
  }
  return runs.filter(r => r.text.length > 0);
}

const HEADING2_RE = /^##\s+(.*)$/;
const HEADING1_RE = /^#\s+(.*)$/;
const BULLET_RE = /^-\s+(.*)$/;

// Splits raw (unescaped) note content into block-level lines. A literal
// newline in the source is always a line break (not reflowed into a
// paragraph) — the spec lists "line breaks" as a supported element in its
// own right.
function parseBlocks(content) {
  return String(content)
    .split('\n')
    .map(rawLine => {
      const line = escapeHtml(rawLine);
      if (line.trim() === '') return { kind: 'blank', runs: [] };
      const h2 = line.match(HEADING2_RE);
      if (h2) return { kind: 'h2', runs: parseInline(h2[1]) };
      const h1 = line.match(HEADING1_RE);
      if (h1) return { kind: 'h1', runs: parseInline(h1[1]) };
      const li = line.match(BULLET_RE);
      if (li) return { kind: 'li', runs: parseInline(li[1]) };
      return { kind: 'p', runs: parseInline(line) };
    });
}

// Greedy word-wrap that carries each word's style through wrapping, then
// regroups consecutive same-style words on the resulting line back into
// runs. Same technique as geometry.js wrapLabel, generalised to per-word
// style instead of a single plain string.
function wrapRuns(runs, maxChars) {
  const words = [];
  runs.forEach(run => {
    String(run.text)
      .split(/\s+/)
      .filter(Boolean)
      .forEach(word => {
        words.push({ word, bold: !!run.bold, italic: !!run.italic, code: !!run.code, href: run.href || null });
      });
  });
  if (!words.length) return [[]];

  const lines = [];
  let cur = [];
  let curLen = 0;
  words.forEach(w => {
    const addLen = curLen ? w.word.length + 1 : w.word.length;
    if (curLen + addLen > maxChars && cur.length) {
      lines.push(cur);
      cur = [w];
      curLen = w.word.length;
    } else {
      cur.push(w);
      curLen += addLen;
    }
  });
  if (cur.length) lines.push(cur);

  const sameStyle = (a, b) => a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href;

  return lines.map(lineWords => {
    const grouped = [];
    lineWords.forEach(w => {
      const prev = grouped[grouped.length - 1];
      const run = { text: w.word, bold: w.bold, italic: w.italic, code: w.code, href: w.href };
      if (!prev) {
        grouped.push(run);
      } else if (sameStyle(prev, run)) {
        prev.text += ' ' + w.word;
      } else if (!run.href) {
        // A run boundary becomes a sibling tspan with no x reset, so the space
        // must live inside one tspan's text or it is lost: "**cap** halts"
        // would render "caphalts". The space leads the new, non-link run.
        run.text = ' ' + run.text;
        grouped.push(run);
      } else if (!prev.href) {
        // The new run is a link: the space trails the text before it, so it
        // stays outside the link's underline.
        prev.text += ' ';
        grouped.push(run);
      } else {
        // Two different links meet: the space belongs to neither.
        grouped.push({ text: ' ', bold: false, italic: false, code: false, href: null });
        grouped.push(run);
      }
    });
    return grouped;
  });
}

// Deliberately conservative (wide) average-glyph-width factor: biases
// toward wrapping a little earlier than a real font would need, so the
// exact line set computed here — reused verbatim by notes-render.js — has
// a safety margin against the box being too short. See
// docs/design/n8n-visual-style.md "Placement" (height must be known at
// layout time, and rendered text must never overflow the box).
const AVG_CHAR_FACTOR = 0.62;

function maxCharsFor(widthPx, fontSize) {
  return Math.max(4, Math.floor(widthPx / (fontSize * AVG_CHAR_FACTOR)));
}

function metricsFor(kind) {
  if (kind === 'h1') return { fontSize: NOTE_H1_SIZE, lineHeight: NOTE_H1_LINE_HEIGHT };
  if (kind === 'h2') return { fontSize: NOTE_H2_SIZE, lineHeight: NOTE_H2_LINE_HEIGHT };
  return { fontSize: NOTE_FONT_SIZE, lineHeight: NOTE_LINE_HEIGHT };
}

// The single source of truth for a note's text layout: the same `lines`
// array drives both the box height (at layout time, before edges are
// routed) and the SVG markup (notes-render.js) — there is no separate
// "estimate vs measure" step for them to disagree on.
function layoutMarkdown(content, innerWidth) {
  const blocks = parseBlocks(content);
  const lines = [];
  let height = 0;

  blocks.forEach(block => {
    if (block.kind === 'blank') {
      lines.push({ kind: 'blank', runs: [], indent: 0, bulletMarker: false });
      height += NOTE_BLANK_GAP;
      return;
    }
    const { fontSize, lineHeight } = metricsFor(block.kind);
    const indent = block.kind === 'li' ? NOTE_BULLET_INDENT : 0;
    const maxChars = maxCharsFor(innerWidth - indent, fontSize);
    const wrapped = wrapRuns(block.runs, maxChars);
    wrapped.forEach((runsOnLine, i) => {
      lines.push({ kind: block.kind, runs: runsOnLine, indent, bulletMarker: block.kind === 'li' && i === 0 });
      height += lineHeight;
    });
  });

  return { lines, height };
}

module.exports = {
  escapeHtml,
  parseInline,
  parseBlocks,
  wrapRuns,
  layoutMarkdown,
  metricsFor,
  ALLOWED_LINK_PROTOCOLS,
};
