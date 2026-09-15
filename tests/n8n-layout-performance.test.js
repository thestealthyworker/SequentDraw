// Regression coverage for the ELK-layered-algorithm denial-of-service fix
// (see src/n8n/layout-budget.js for the root-cause writeup): a dense,
// heavily-cyclic document at the documented caps (100 nodes, 500 edges —
// validate.js) used to leave renderMap/renderSvg running for minutes
// because direction.js hands ELK a graph whose forced total order lets
// edges span nearly the whole rank range, and ELK's default
// nodePlacement.strategy (NETWORK_SIMPLEX) blows up on the resulting
// dummy-node count. Every case here is a variant of the lead developer's
// original reproduction: N nodes, solid edges from n<a> to n<b> (a != b)
// from a seeded LCG, still cyclic by construction.
//
// CPU time (user+system), not wall-clock: node --test spawns one process
// per test file and this suite runs alongside sibling files, so
// wall-clock elapsed time is dominated by scheduling contention rather
// than the renderer's own work — process.cpuUsage() only accrues while
// this process is actually on a CPU, which is what "under 10 seconds" is
// actually bounding. Same measure tests/n8n-doc-export.test.js's own
// timing test uses.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { renderMap, renderSvg } = require('../src/n8n/index');

const N = 100;
const CPU_BUDGET_MS = 10000;

// The lead developer's exact reproduction generator, parameterised by
// seed so five independent seeds can be checked without five copies of
// this function.
function randomCyclicDoc(seed, type) {
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service' });
  const edges = [];
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 500; i++) {
    const a = Math.floor(rnd() * N);
    let b = Math.floor(rnd() * N);
    if (b === a) b = (b + 1) % N;
    edges.push({ from: `n${a}`, to: `n${b}`, type });
  }
  return { title: 'cyclic', nodes, edges };
}

// 100 nodes x 5 out-edges each (n_i -> n_{i+1..i+5} mod N): dense and
// cyclic (every edge points "forward" mod N, which wraps into a cycle),
// exactly 500 edges — the documented edge cap.
function denseCycleDoc(type) {
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service' });
  const edges = [];
  for (let i = 0; i < N; i++) {
    for (let k = 1; k <= 5; k++) edges.push({ from: `n${i}`, to: `n${(i + k) % N}`, type });
  }
  return { title: 'dense-cycle', nodes, edges };
}

// A single 100-node cycle: n0 -> n1 -> ... -> n99 -> n0.
function singleCycleDoc(type) {
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service' });
  const edges = [];
  for (let i = 0; i < N; i++) edges.push({ from: `n${i}`, to: `n${(i + 1) % N}`, type });
  return { title: 'single-cycle', nodes, edges };
}

// A star of 100 nodes: every other node has an edge into the hub and one
// back out of it (198 edges), maximally cyclic around a single node.
function starDoc(type) {
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service' });
  const edges = [];
  for (let i = 1; i < N; i++) {
    edges.push({ from: `n${i}`, to: 'n0', type });
    edges.push({ from: 'n0', to: `n${i}`, type });
  }
  return { title: 'star', nodes, edges };
}

const cases = [
  ['random seed=7 (the reported reproduction)', type => randomCyclicDoc(7, type)],
  ['random seed=11', type => randomCyclicDoc(11, type)],
  ['random seed=23', type => randomCyclicDoc(23, type)],
  ['random seed=41', type => randomCyclicDoc(41, type)],
  ['random seed=99', type => randomCyclicDoc(99, type)],
  ['dense-cycle (100 nodes x 5 out-edges, 500 edges)', denseCycleDoc],
  ['single 100-node cycle', singleCycleDoc],
  ['star (100 nodes, all edges into/out of one hub)', starDoc],
];

async function assertUnderBudget(run) {
  const cpuBefore = process.cpuUsage();
  await run();
  const cpuDelta = process.cpuUsage(cpuBefore);
  const cpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
  assert.ok(cpuMs < CPU_BUDGET_MS, `took ${cpuMs.toFixed(1)}ms of CPU time, expected < ${CPU_BUDGET_MS}ms`);
}

describe('layout performance: dense/cyclic documents finish under the CPU budget', () => {
  cases.forEach(([label, buildDoc]) => {
    describe(label, () => {
      test('renderMap, solid edges', async () => {
        await assertUnderBudget(() => renderMap(buildDoc('solid')));
      });
      test('renderMap, all-dashed edges', async () => {
        await assertUnderBudget(() => renderMap(buildDoc('dashed')));
      });
      test('renderSvg, solid edges', async () => {
        await assertUnderBudget(() => renderSvg(buildDoc('solid'), { layers: [] }));
      });
      test('renderSvg, all-dashed edges', async () => {
        await assertUnderBudget(() => renderSvg(buildDoc('dashed'), { layers: [] }));
      });
    });
  });
});

// Issue #20: grouped documents. None of the cases above declare any
// groups, so they never exercised ELK's `elk.hierarchyHandling` path —
// with hierarchyHandling INCLUDE_CHILDREN, an edge crossing a group
// boundary forces expensive hierarchical crossing-minimization/port work
// almost independent of the flat layer-span estimate above, which is what
// let some of these shapes slip through with a *low* flat estimate (kept
// on the un-bounded, original-options path) while still costing multiple
// seconds to tens of seconds of CPU. See src/n8n/layout-budget.js's header
// for the full root-cause writeup, the cross-group-edge/group-count
// weighting added to the estimator, and the measurements behind each shape
// below.

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

// The lead developer's exact reproduction: 50 groups of 2 nodes each, a
// 99-edge n0->n1->...->n99 chain (about half of it lands inside a pair's
// own group), plus 400 edges from a random node in 0-19 to a random node
// in 80-99 (seed 11) — almost all of those cross a group boundary.
function groupedReproDoc(seed, type) {
  const numGroups = 50;
  const groups = [];
  for (let g = 0; g < numGroups; g++) groups.push({ id: `g${g}`, label: `Group ${g}` });
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service', parentId: `g${Math.floor(i / 2)}` });
  const edges = [];
  for (let i = 0; i < N - 1; i++) edges.push({ from: `n${i}`, to: `n${i + 1}`, type });
  const rnd = lcg(seed);
  for (let i = 0; i < 400; i++) {
    const a = Math.floor(rnd() * 20);
    const b = 80 + Math.floor(rnd() * 20);
    edges.push({ from: `n${a}`, to: `n${b}`, type });
  }
  return { title: 'grouped-repro', groups, nodes, edges };
}

// 50 groups of 2 nodes, every one of the 500 edges crosses a group
// boundary: a deterministic "+2" backbone (jumping by exactly one group's
// worth of nodes always lands outside the source's own 2-node group, and,
// being a permutation of all 100 ids, never leaves a node orphaned) topped
// up with random cross-group edges (rejection-sampled against same-group
// pairs) to the 500-edge cap.
function groupedAllCrossDoc(seed, type) {
  const numGroups = 50;
  const groups = [];
  for (let g = 0; g < numGroups; g++) groups.push({ id: `g${g}`, label: `Group ${g}` });
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service', parentId: `g${Math.floor(i / 2)}` });
  const groupOf = i => Math.floor(i / 2);
  const edges = [];
  for (let i = 0; i < N; i++) edges.push({ from: `n${i}`, to: `n${(i + 2) % N}`, type });
  const rnd = lcg(seed);
  while (edges.length < 500) {
    const a = Math.floor(rnd() * N);
    const b = Math.floor(rnd() * N);
    if (groupOf(a) === groupOf(b)) continue;
    edges.push({ from: `n${a}`, to: `n${b}`, type });
  }
  return { title: 'grouped-all-cross', groups, nodes, edges };
}

// 25 groups of 4 nodes: a deterministic "+4" backbone (same no-orphan,
// always-cross-group reasoning as above) topped up with edges deliberately
// drawn from the first two groups to the last two groups — as long a
// cross-group span as this shape allows — up to the 500-edge cap.
function groupedLongCrossDoc(seed, type) {
  const numGroups = 25;
  const groups = [];
  for (let g = 0; g < numGroups; g++) groups.push({ id: `g${g}`, label: `Group ${g}` });
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service', parentId: `g${Math.floor(i / 4)}` });
  const edges = [];
  for (let i = 0; i < N; i++) edges.push({ from: `n${i}`, to: `n${(i + 4) % N}`, type });
  const rnd = lcg(seed);
  while (edges.length < 500) {
    const a = Math.floor(rnd() * 8); // first two groups
    const b = 92 + Math.floor(rnd() * 8); // last two groups
    edges.push({ from: `n${a}`, to: `n${b}`, type });
  }
  return { title: 'grouped-long-cross', groups, nodes, edges };
}

// 10 groups of 10 nodes, dense cyclic: the same shape as denseCycleDoc
// above (every node has 5 forward out-edges, cyclic mod N, so it is never
// orphaned) with group membership laid on top — most edges land inside a
// group (nodes within 5 of each other are usually in the same 10-node
// group) but the ones that don't are enough to exercise the hierarchy
// path.
function groupedDenseCyclicDoc(type) {
  const numGroups = 10;
  const groups = [];
  for (let g = 0; g < numGroups; g++) groups.push({ id: `g${g}`, label: `Group ${g}` });
  const nodes = [];
  for (let i = 0; i < N; i++) nodes.push({ id: `n${i}`, label: `N${i}`, kind: 'service', parentId: `g${Math.floor(i / 10)}` });
  const edges = [];
  for (let i = 0; i < N; i++) {
    for (let k = 1; k <= 5; k++) edges.push({ from: `n${i}`, to: `n${(i + k) % N}`, type });
  }
  return { title: 'grouped-dense-cyclic', groups, nodes, edges };
}

const groupedCases = [
  ['grouped: 50 groups x 2 nodes reproduction (issue #20)', type => groupedReproDoc(11, type)],
  ['grouped: 50 groups x 2 nodes, all 500 edges cross-group', type => groupedAllCrossDoc(3, type)],
  ['grouped: 25 groups x 4 nodes, 500 long-span cross-group edges', type => groupedLongCrossDoc(5, type)],
  ['grouped: 10 groups x 10 nodes, dense cyclic', groupedDenseCyclicDoc],
];

describe('layout performance: grouped documents finish under the CPU budget (issue #20)', () => {
  groupedCases.forEach(([label, buildDoc]) => {
    describe(label, () => {
      test('renderMap, solid edges', async () => {
        await assertUnderBudget(() => renderMap(buildDoc('solid')));
      });
      test('renderMap, all-dashed edges', async () => {
        await assertUnderBudget(() => renderMap(buildDoc('dashed')));
      });
      test('renderSvg, solid edges', async () => {
        await assertUnderBudget(() => renderSvg(buildDoc('solid'), { layers: [] }));
      });
      test('renderSvg, all-dashed edges', async () => {
        await assertUnderBudget(() => renderSvg(buildDoc('dashed'), { layers: [] }));
      });
    });
  });
});
