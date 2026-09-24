// The command forms every skill's `references/cli-pipeline.md` documents
// (issue #51), run in the exact shell shape a narrow `Bash(node:*)` grant
// accepts: a printf-piped document or patch into `node <abs>/bin/sequentdraw`,
// every output into a folder that does not exist yet. Also keeps that
// reference byte-identical across the skills, so a fix to one reaches all.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');
const MEDUSA = path.join(ROOT, 'examples', 'medusa-return-flow.json');
const COMPOSE_APP = path.join(ROOT, 'tests', 'fixtures', 'repos', 'compose-app');
const SKILLS_DIR = path.join(ROOT, 'skills');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runCli(args, cwd, { input } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input });
}

// printf '%s' '<json>' | node <bin> <args>, apostrophes written as '.
function runPrintfPipe(value, args, cwd) {
  const json = JSON.stringify(value).replace(/'/g, '\\u0027');
  const command = `printf '%s' '${json}' | ${shellQuote(process.execPath)} ${shellQuote(BIN)} ${args.map(shellQuote).join(' ')}`;
  return spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-pipeline-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function composeMap(bundlePath) {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const id = predicate => bundle.evidence.find(predicate).id;
  const service = name => id(e => e.kind === 'compose-service' && e.value === name);
  return {
    title: 'compose-app architecture',
    nodes: [
      { id: 'web', label: 'web', kind: 'service', source: 'scan', evidence: [service('web')] },
      { id: 'api', label: 'api', kind: 'service', source: 'scan', evidence: [service('api')] },
    ],
    edges: [
      {
        from: 'web',
        to: 'api',
        type: 'dashed',
        description: 'starts after api',
        source: 'scan',
        evidence: [id(e => e.kind === 'depends-on' && e.from === 'web' && e.to === 'api')],
      },
    ],
  };
}

test('git-map: scan, printf first save with --evidence and --emit-open, re-check and render by path, all into new folders', () => {
  withTempDir(dir => {
    const scan = runCli(['scan', COMPOSE_APP, '--out', 'run/bundle.json'], dir);
    assert.strictEqual(scan.status, 0, scan.stderr);
    assert.match(scan.stdout, /^wrote run\/bundle\.json \(\d+ evidence entries\)$/m);

    const map = composeMap(path.join(dir, 'run', 'bundle.json'));
    const save = runPrintfPipe(map, ['check', '-', '--evidence', 'run/bundle.json', '--emit-open', 'out/map.json'], dir);
    assert.strictEqual(save.status, 0, save.stderr);
    assert.strictEqual(save.stdout, 'wrote out/map.json (0 open nodes)\n');

    const recheck = runCli(['check', 'out/map.json', '--evidence', 'run/bundle.json'], dir);
    assert.strictEqual(recheck.status, 0, recheck.stderr);
    assert.strictEqual(recheck.stdout, 'ok\n');

    const render = runCli(['render', 'out/map.json', 'html/map.html', '--fragment'], dir);
    assert.strictEqual(render.status, 0, render.stderr);
    assert.match(render.stdout, /^wrote html\/map\.html \(\d+kb\)$/m);
  });
});

test('git-map: a printf first save citing the wrong evidence writes nothing', () => {
  withTempDir(dir => {
    const scan = runCli(['scan', COMPOSE_APP, '--out', 'run/bundle.json'], dir);
    assert.strictEqual(scan.status, 0, scan.stderr);
    const map = composeMap(path.join(dir, 'run', 'bundle.json'));
    map.edges[0].evidence = map.nodes[0].evidence;
    const save = runPrintfPipe(map, ['check', '-', '--evidence', 'run/bundle.json', '--emit-open', 'out/map.json'], dir);
    assert.strictEqual(save.status, 1);
    assert.match(save.stderr, /^\/edges\/0\/evidence {2}/m);
    assert.strictEqual(fs.existsSync(path.join(dir, 'out')), false);
  });
});

test('git-map: a correction patch merges onto the saved map with --evidence still enforced', () => {
  withTempDir(dir => {
    runCli(['scan', COMPOSE_APP, '--out', 'run/bundle.json'], dir);
    const map = composeMap(path.join(dir, 'run', 'bundle.json'));
    fs.writeFileSync(path.join(dir, 'run', 'map.json'), JSON.stringify(map));
    const patch = {
      nodes: [{ id: 'q_api', label: 'What does api call?', kind: 'logic', status: 'open', prompt: 'Which vendor does api call?' }],
      edges: [{ from: 'api', to: 'q_api', type: 'dashed' }],
    };
    const result = runPrintfPipe(patch, ['check', 'run/map.json', '--merge', '-', '--evidence', 'run/bundle.json', '--emit-open', 'out/map-2.json'], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, 'wrote out/map-2.json (0 open nodes)\n');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'map-2.json'), 'utf8'));
    assert.deepStrictEqual(written.nodes.map(n => n.id), ['web', 'api', 'q_api']);
  });
});

// --- render --merge: doc-map writes confirmed descriptions into the figure
// without re-typing the map and without check --emit-open's gap nodes.

function describePatch() {
  const doc = JSON.parse(fs.readFileSync(MEDUSA, 'utf8'));
  const target = doc.nodes.find(n => n.id === 'customer');
  return {
    remove: { nodes: ['customer'] },
    nodes: [{ ...target, description: "The shopper's return" }],
    edges: doc.edges.filter(e => e.from === 'customer' || e.to === 'customer'),
  };
}

test('render --merge -: a printf-piped patch reaches the SVG, the map file is untouched and no open nodes are added', () => {
  withTempDir(dir => {
    const before = fs.readFileSync(MEDUSA, 'utf8');
    const result = runPrintfPipe(describePatch(), ['render', MEDUSA, 'figs/map.svg', '--layers', 'business', '--merge', '-'], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^wrote figs\/map\.svg \(\d+kb\)$/m);
    const svg = fs.readFileSync(path.join(dir, 'figs', 'map.svg'), 'utf8');
    assert.match(svg, />The shopper(?:'|&#39;|&#x27;|&apos;)s return</);
    assert.strictEqual(fs.readFileSync(MEDUSA, 'utf8'), before);

    // Replacing one description adds no text: no gap nodes were drawn.
    const plain = runCli(['render', MEDUSA, 'figs/plain.svg', '--layers', 'business'], dir);
    assert.strictEqual(plain.status, 0, plain.stderr);
    const plainSvg = fs.readFileSync(path.join(dir, 'figs', 'plain.svg'), 'utf8');
    const count = text => (text.match(/<text\b/g) || []).length;
    assert.ok(count(plainSvg) > 0);
    assert.strictEqual(count(svg), count(plainSvg));
  });
});

test('render --merge <file>: a patch file works with html output too', () => {
  withTempDir(dir => {
    fs.writeFileSync(path.join(dir, 'patch.json'), JSON.stringify(describePatch()));
    const result = runCli(['render', MEDUSA, 'out/map.html', '--fragment', '--merge', 'patch.json'], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^wrote out\/map\.html \(\d+kb\)$/m);
  });
});

test('render --merge: a patch that cannot be applied writes nothing', () => {
  withTempDir(dir => {
    const result = runPrintfPipe({ remove: { nodes: ['nope'] } }, ['render', MEDUSA, 'figs/map.svg', '--merge', '-'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /^--merge could not apply the patch; nothing was written\.$/m);
    assert.match(result.stderr, /^\/remove\/nodes\/0 {2}--merge: "nope" is not a node/m);
    assert.strictEqual(fs.existsSync(path.join(dir, 'figs')), false);
  });
});

test('render --merge: usage errors', () => {
  withTempDir(dir => {
    const bothStdin = runCli(['render', '-', 'x.svg', '--merge', '-'], dir, { input: '{}' });
    assert.strictEqual(bothStdin.status, 1);
    assert.match(bothStdin.stderr, /cannot both read stdin/);

    const missing = runCli(['render', MEDUSA, 'x.svg', '--merge'], dir);
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /Usage: sequentdraw render/);

    const badJson = runCli(['render', MEDUSA, 'x.svg', '--merge', '-'], dir, { input: '{nope' });
    assert.strictEqual(badJson.status, 1);
    assert.match(badJson.stderr, /^--merge: /m);
    assert.deepStrictEqual(fs.readdirSync(dir), []);

    const help = runCli(['render', '--help'], dir);
    assert.match(help.stdout, /--merge <patch>/);
  });
});

// --- one shared reference ---------------------------------------------------

test('every skill ships the same references/cli-pipeline.md', () => {
  const skills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  assert.deepStrictEqual(skills, ['business-map', 'doc-map', 'eval-build', 'git-map', 'gitrepo-suggest', 'grill-build']);
  const copies = skills.map(name => fs.readFileSync(path.join(SKILLS_DIR, name, 'references', 'cli-pipeline.md'), 'utf8'));
  copies.forEach((copy, i) => assert.strictEqual(copy, copies[0], `skills/${skills[i]}/references/cli-pipeline.md differs from skills/${skills[0]}'s`));
});
