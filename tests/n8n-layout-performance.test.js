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
