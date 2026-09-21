// Shared geometry and style constants for the n8n-style renderer.
// Values come from docs/design/n8n-visual-style.md — measurements, not n8n source.

const GRID = 16;

const NODE_SIZE = 96; // 96x96 rounded square
const NODE_RADIUS = 20; // default corner radius
const ENTRY_RADIUS = 36; // left-side corner radius for entry ("D") nodes

const LABEL_LINES_MAX = 2;
// Reserved footprint below a node for its label + sublabel, per spec ("~48px").
// Baseline offsets are tuned so a full 2-line label plus a sublabel exactly
// fits the reserve: 18 + 16 + 14 = 48.
const LABEL_RESERVE = 48;
const LABEL_FIRST_BASELINE_OFFSET = 18; // node bottom -> first label line baseline
const LABEL_LINE_HEIGHT = 16; // label line 1 baseline -> line 2 baseline
const SUBLABEL_GAP = 14; // last label baseline -> sublabel baseline

const RANK_GAP = 128; // horizontal gap between ELK ranks (flow direction RIGHT)
const NODE_GAP = 96; // gap between nodes within a rank (perpendicular to flow)

const HANDLE_RADIUS = 8; // 16px circle
const HANDLE_BORDER = '#bbbbbb';

const BACKWARD_DROP = 130; // px to drop below source before routing back
const BACKWARD_STUB = 40; // px stub length in/out of a backward detour
const BACKWARD_CORNER_RADIUS = 16;

const GROUP_PADDING = { top: 40, left: 24, right: 24, bottom: 24 };
const GROUP_RADIUS = 4;
// Frame title text offset from the frame box's top-left corner. Named so
// render-svg.js's frameMarkup() and the viewer's runtime frame-box resize
// (render-shell.js, via frame-box.js) always agree on where the label sits.
const FRAME_LABEL_OFFSET_X = 12;
const FRAME_LABEL_OFFSET_Y = 22;

const GROUP_COLORS = {
  purple: { fill: '#EFEBFC', border: '#8B7FD1', title: '#4C3F91' },
  teal: { fill: '#E3F6F1', border: '#3FA88F', title: '#1F6B58' },
  coral: { fill: '#FBEAE4', border: '#D97757', title: '#9A4A2B' },
  pink: { fill: '#FCEAF1', border: '#D6699A', title: '#9C3F6C' },
  blue: { fill: '#E8F1FC', border: '#5B8DD9', title: '#33578F' },
  green: { fill: '#EAF6E9', border: '#6FA766', title: '#3E6F37' },
  amber: { fill: '#FCF3E1', border: '#D9A441', title: '#8F6A1F' },
  gray: { fill: '#F1F1EF', border: '#9C9C97', title: '#5B5B57' },
};

const NODE_BORDER = 'rgba(0,0,0,0.1)';
const NODE_BORDER_WIDTH = 1.5;
const OPEN_FILL = '#f3f3f3';
const OPEN_BORDER = '#9c9c97';
const SUGGESTED_BORDER = '#7c5cc4';

const EDGE_STROKE = '#c4c4c4';
const EDGE_STROKE_HOVER = '#8f8f8f';
const EDGE_WIDTH = 2;
const EDGE_DASH = '5 6';

const GLYPH_STROKE = '#555555';
const BRAND_ICON_SIZE = 48;
const GLYPH_ICON_SIZE = 40;
const ICON_VIEWBOX = 24; // simple-icons / kind glyph source coordinate space

const DOT_GRID_GAP = 16;
const DOT_COLOR = '#b8b8b8';
const CANVAS_FILL = '#f5f5f5';

const CANVAS_MARGIN = 64;

// Sticky notes (text boxes). Values come from
// docs/design/n8n-visual-style.md "Notes (text boxes)".
const NOTE_MIN_WIDTH = 240;
const NOTE_MAX_WIDTH = 480;
const NOTE_PAD_X = 14;
const NOTE_PAD_Y = 12;
const NOTE_GAP = 16; // gap kept from an attached bounding box, and the grid step used to push a note outward when the first candidate is not clear
// How far an attached note may sit from a thing it annotates before that
// link stops reading as a link. One rank spacing (RANK_GAP): at more than
// one node-spacing away the reader attributes the note to whatever it has
// drifted next to instead. notes.js searches for a placement within this
// distance of every target first, and draws a connector line to any target
// it could not get close enough to (two nodes 1,100px apart cannot both
// have a note beside them).
const NOTE_ATTACH_MAX_GAP = 128;
const NOTE_RADIUS = 4;
const NOTE_BORDER_WIDTH = 1;

const NOTE_FONT_SIZE = 13;
const NOTE_LINE_HEIGHT = 18;
const NOTE_H1_SIZE = 15;
const NOTE_H1_LINE_HEIGHT = 20;
const NOTE_H2_SIZE = 14;
const NOTE_H2_LINE_HEIGHT = 19;
const NOTE_BULLET_INDENT = 14;
const NOTE_BLANK_GAP = 8; // vertical space for a blank line in the source content

// Soft fills with slightly darker borders, consistent with the frame
// palette (GROUP_COLORS above) — shared hues (blue, green, purple, gray)
// reuse the same values so a note and a frame of the "same" colour match.
const NOTE_COLORS = {
  yellow: { fill: '#FFF6CC', border: '#D9B93B' },
  gold: { fill: '#FBEBC9', border: '#C99A2E' },
  red: { fill: '#FBE3E1', border: '#D9695B' },
  green: { fill: '#EAF6E9', border: '#6FA766' },
  blue: { fill: '#E8F1FC', border: '#5B8DD9' },
  purple: { fill: '#EFEBFC', border: '#8B7FD1' },
  gray: { fill: '#F1F1EF', border: '#9C9C97' },
};

// Documentation export (SVG with inline captions). See
// docs/design/n8n-visual-style.md "Documentation export (SVG with inline
// captions)". Kept separate from the interactive-view constants above so
// the interactive layout/render path never reads these.
const CAPTION_FONT_SIZE = 12;
const CAPTION_LINE_HEIGHT = 14;
// A ceiling against absurd input, NOT a design target. A caption wraps to
// as many lines as its description needs (see geometry.js wrapParagraph);
// this only stops a pathological document from reserving an unbounded
// strip under every node. At CAPTION_WRAP_WIDTH/CAPTION_FONT_SIZE a line
// holds ~26 characters, so 16 lines covers SPEC.md's 280-character
// maximum description with room to spare and is never reached in practice
// (the Medusa fixture's longest description uses 5).
const CAPTION_LINES_MAX = 16;
const CAPTION_GAP = 6; // gap between the sublabel baseline and the first caption line's top
const CAPTION_COLOR = '#6b6b66';
// Extra width allowance for wrapping caption text under a node. Wider than
// the sublabel's 64 so a real description fits in fewer lines, but bounded
// by the closest two nodes can ever sit: layout.js's
// resolveHorizontalCrowding guarantees NODE_GAP (96px) of clear space
// between two nodes sharing a row, and a centred caption spreads
// CAPTION_WRAP_PAD/2 past each side of its 96px node, so 80 leaves 16px
// between two neighbouring captions even in that worst case.
const CAPTION_WRAP_PAD = 80;

const DOC_MARGIN = 32; // crop margin around the content, per the doc-export spec
const DOC_TITLE_FONT_SIZE = 18;
const DOC_TITLE_BLOCK_HEIGHT = 40; // vertical room reserved above the content for the title
// Vertical room for the status key row under the content, reserved only
// when the figure has open or suggested nodes to explain (render-doc.js).
const DOC_KEY_BLOCK_HEIGHT = 24;

const EDGE_TEXT_FONT_SIZE = 11;
// Edge text wraps onto further lines instead of being cut short, for the
// same reason captions do: this figure is read where nobody can hover, so
// "Return id and the items approved for re…" is worse than either the full
// sentence or no label at all. EDGE_TEXT_LINES_MAX is a ceiling, not a
// target — at this wrap width a line holds ~38 characters, so 8 lines
// covers SPEC.md's 200-character maximum edge description and is never
// reached by real content (Medusa's longest edge text uses 2). An edge
// label that cannot be placed clear of everything is still omitted rather
// than forced in, per the doc-export spec.
const EDGE_TEXT_WRAP_WIDTH = 240;
const EDGE_TEXT_LINE_HEIGHT = 14;
const EDGE_TEXT_LINES_MAX = 8;
const EDGE_TEXT_PAD_X = 6;
const EDGE_TEXT_PAD_Y = 4;
const EDGE_TEXT_COLOR = '#4a4a46';
const EDGE_TEXT_BG = '#ffffff';
const EDGE_TEXT_BORDER = '#d8d8d3';

// Single-quoted family names, not double: this stack is written straight
// into a double-quoted SVG attribute value (see render-doc.js), and a
// literal `"` there would end the attribute early.
const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function snap(value) {
  return Math.round(value / GRID) * GRID;
}

module.exports = {
  GRID,
  NODE_SIZE,
  NODE_RADIUS,
  ENTRY_RADIUS,
  LABEL_LINES_MAX,
  LABEL_RESERVE,
  LABEL_FIRST_BASELINE_OFFSET,
  LABEL_LINE_HEIGHT,
  SUBLABEL_GAP,
  RANK_GAP,
  NODE_GAP,
  HANDLE_RADIUS,
  HANDLE_BORDER,
  BACKWARD_DROP,
  BACKWARD_STUB,
  BACKWARD_CORNER_RADIUS,
  GROUP_PADDING,
  GROUP_RADIUS,
  FRAME_LABEL_OFFSET_X,
  FRAME_LABEL_OFFSET_Y,
  GROUP_COLORS,
  NODE_BORDER,
  NODE_BORDER_WIDTH,
  OPEN_FILL,
  OPEN_BORDER,
  SUGGESTED_BORDER,
  EDGE_STROKE,
  EDGE_STROKE_HOVER,
  EDGE_WIDTH,
  EDGE_DASH,
  GLYPH_STROKE,
  BRAND_ICON_SIZE,
  GLYPH_ICON_SIZE,
  ICON_VIEWBOX,
  DOT_GRID_GAP,
  DOT_COLOR,
  CANVAS_FILL,
  CANVAS_MARGIN,
  NOTE_MIN_WIDTH,
  NOTE_MAX_WIDTH,
  NOTE_PAD_X,
  NOTE_PAD_Y,
  NOTE_GAP,
  NOTE_ATTACH_MAX_GAP,
  NOTE_RADIUS,
  NOTE_BORDER_WIDTH,
  NOTE_FONT_SIZE,
  NOTE_LINE_HEIGHT,
  NOTE_H1_SIZE,
  NOTE_H1_LINE_HEIGHT,
  NOTE_H2_SIZE,
  NOTE_H2_LINE_HEIGHT,
  NOTE_BULLET_INDENT,
  NOTE_BLANK_GAP,
  NOTE_COLORS,
  CAPTION_FONT_SIZE,
  CAPTION_LINE_HEIGHT,
  CAPTION_LINES_MAX,
  CAPTION_GAP,
  CAPTION_COLOR,
  CAPTION_WRAP_PAD,
  DOC_MARGIN,
  DOC_TITLE_FONT_SIZE,
  DOC_TITLE_BLOCK_HEIGHT,
  DOC_KEY_BLOCK_HEIGHT,
  EDGE_TEXT_FONT_SIZE,
  EDGE_TEXT_WRAP_WIDTH,
  EDGE_TEXT_LINE_HEIGHT,
  EDGE_TEXT_LINES_MAX,
  EDGE_TEXT_PAD_X,
  EDGE_TEXT_PAD_Y,
  EDGE_TEXT_COLOR,
  EDGE_TEXT_BG,
  EDGE_TEXT_BORDER,
  SYSTEM_FONT_STACK,
  snap,
};
