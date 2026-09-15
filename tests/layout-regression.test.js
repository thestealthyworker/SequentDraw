// Layout regression: rendering the Medusa fixture must reproduce the prototype's
// reference output. ELK is deterministic, so any drift means a layout option,
// input order or coordinate-frame handling changed.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'examples/medusa-return-flow.json');
const REFERENCE = path.join(ROOT, 'examples/reference/medusa-return-flow.html');
const TOLERANCE_PX = 0.5;

function parseRender(html) {
  const nodes = {};
  const groups = {};
  const nodeRe = /<g class="nd[^"]*" data-id="([^"]+)"[^>]*>(?:<title>.*?<\/title>)?\n<circle cx="([\d.]+)" cy="([\d.]+)"/g;
  const groupRe = /data-group="([^"]+)"><rect class="grect" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  for (const [, id, cx, cy] of html.matchAll(nodeRe)) nodes[id] = [Number(cx), Number(cy)];
  for (const [, id, ...box] of html.matchAll(groupRe)) groups[id] = box.map(Number);
  const [, width, height] = html.match(/<svg width="(\d+)" height="(\d+)"/);
  return { nodes, groups, size: [Number(width), Number(height)] };
}

function render(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-'));
  const out = path.join(dir, 'map.html');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'src/render-html.js'), fixture, out], { stdio: 'pipe' });
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const reference = parseRender(fs.readFileSync(REFERENCE, 'utf8'));
const candidate = parseRender(render(FIXTURE));

test('reference parses to the documented fixture size', () => {
  assert.strictEqual(Object.keys(reference.nodes).length, 40);
  assert.strictEqual(Object.keys(reference.groups).length, 5);
});

test('canvas size matches reference', () => {
  assert.deepStrictEqual(candidate.size, reference.size);
});

test('every node sits where the reference placed it', () => {
  assert.deepStrictEqual(Object.keys(candidate.nodes).sort(), Object.keys(reference.nodes).sort());
  const drifted = Object.entries(reference.nodes)
    .map(([id, [x, y]]) => [id, Math.hypot(x - candidate.nodes[id][0], y - candidate.nodes[id][1])])
    .filter(([, d]) => d > TOLERANCE_PX)
    .map(([id, d]) => `${id} moved ${d.toFixed(1)}px`);
  assert.deepStrictEqual(drifted, []);
});

test('every group box matches reference', () => {
  for (const [id, box] of Object.entries(reference.groups)) {
    const got = candidate.groups[id];
    assert.ok(got, `group ${id} missing`);
    box.forEach((v, i) => assert.ok(Math.abs(v - got[i]) <= TOLERANCE_PX, `group ${id} differs: ${box} vs ${got}`));
  }
});
