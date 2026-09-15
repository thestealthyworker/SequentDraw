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
  snap,
};
