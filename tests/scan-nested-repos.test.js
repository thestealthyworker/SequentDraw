// Issue #34: the scanner must map the repository, not the copies of it that
// happen to sit inside it.
//
// Scanning a checkout carrying four `.claude/worktrees/agent-*` copies gave
// 80 evidence entries, 64 of them from those copies, and drew every component
// five times -- `sequentdraw` x10, `git-map` x5 -- where a clean export of the
// same commit gives 16. The walk descended INTO each worktree and dutifully
// excluded that copy's own `tests/` and `evals/`, never the worktree itself.
// `check --evidence` passed the result, because every duplicate cited real
// evidence: the same class of defect as #27 (fixtures mapped as the
// product) -- real evidence, wrong subject.
//
// The boundary is a `.git` entry inside a candidate directory: a DIRECTORY
// means a nested clone, a FILE containing `gitdir:` means a linked worktree
// (or a submodule). These tests pin both halves: the nested trees are skipped
// and reported, and what remains is the outer repository, counted once.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scanPath } = require('../src/scan/scan');
const { RelevancePolicy, detectRepositoryBoundary } = require('../src/scan/exclusions');
const { makeTempNestedRepoFixture } = require('./fixtures/build-nested-repo-fixture');

const tempDirs = [];

async function tempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sequentdraw-boundary-'));
  tempDirs.push(dir);
  return dir;
}

let fixtureRoot = null;
let bundle = null;

before(async () => {
  fixtureRoot = await makeTempNestedRepoFixture();
  tempDirs.push(fixtureRoot);
  bundle = await scanPath(fixtureRoot, { name: 'outer-app', source: 'local', ref: null });
});

after(async () => {
  for (const dir of tempDirs) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

function exclusionFor(b, p) {
  return b.exclusions.find(e => e.path === p);
}

function componentCounts(b) {
  const counts = {};
  for (const entry of b.evidence.filter(e => e.kind === 'component')) {
    counts[entry.value] = (counts[entry.value] || 0) + 1;
  }
  return counts;
}

describe('repository boundary probe (unit)', () => {
  test('a .git directory marks a nested clone', async () => {
    const dir = await tempDir();
    await fsp.mkdir(path.join(dir, '.git'));
    assert.strictEqual(await detectRepositoryBoundary(dir), 'nested-repository');
  });

  test('a .git file holding a gitdir pointer marks a linked worktree', async () => {
    const dir = await tempDir();
    await fsp.writeFile(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    assert.strictEqual(await detectRepositoryBoundary(dir), 'nested-worktree');
  });

  test('a .git file that is not a gitdir pointer marks nothing', async () => {
    const dir = await tempDir();
    await fsp.writeFile(path.join(dir, '.git'), 'notes about the history\nref: refs/heads/main\n');
    assert.strictEqual(await detectRepositoryBoundary(dir), null);
  });

  test('"gitdir:" must start the file, not merely appear somewhere in it', async () => {
    const dir = await tempDir();
    await fsp.writeFile(path.join(dir, '.git'), 'see the docs, which mention gitdir: pointers\n');
    assert.strictEqual(await detectRepositoryBoundary(dir), null);
  });

  test('a symlinked .git is never followed, and so marks nothing', async () => {
    const real = await tempDir();
    await fsp.mkdir(path.join(real, 'actual-git-dir'));
    const dir = await tempDir();
    await fsp.symlink(path.join(real, 'actual-git-dir'), path.join(dir, '.git'), 'dir');
    assert.strictEqual(await detectRepositoryBoundary(dir), null);
  });

  test('an oversized .git file is refused rather than read into memory', async () => {
    const dir = await tempDir();
    await fsp.writeFile(path.join(dir, '.git'), `gitdir: ${'x'.repeat(200000)}\n`);
    assert.strictEqual(await detectRepositoryBoundary(dir), null);
  });

  test('a directory with no .git entry at all marks nothing', async () => {
    const dir = await tempDir();
    assert.strictEqual(await detectRepositoryBoundary(dir), null);
  });
});

describe('relevance policy: nested repositories', () => {
  test('the scan root is never skipped, however its own .git is shaped', async () => {
    const dir = await tempDir();
    await fsp.writeFile(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/root\n');
    const policy = new RelevancePolicy([]);
    assert.strictEqual(await policy.classifyNestedRepository('.', dir), null);
    assert.strictEqual(await policy.classifyNestedRepository('', dir), null);
  });

  test('a nested worktree and a nested clone each get their own reason', async () => {
    const policy = new RelevancePolicy([]);

    const worktree = await tempDir();
    await fsp.writeFile(path.join(worktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    assert.deepStrictEqual(await policy.classifyNestedRepository('wt', worktree), {
      reason: 'nested-worktree',
      ambiguous: false,
    });

    const clone = await tempDir();
    await fsp.mkdir(path.join(clone, '.git'));
    assert.deepStrictEqual(await policy.classifyNestedRepository('third-party/tool', clone), {
      reason: 'nested-repository',
      ambiguous: false,
    });
  });

  test('a nested repository the manifest names as the product is kept', async () => {
    // A submodule used as a workspace package IS the product. The manifest
    // naming it is the repository's own statement, and it wins.
    const dir = await tempDir();
    await fsp.mkdir(path.join(dir, '.git'));
    const policy = new RelevancePolicy(['packages/foo/index.js']);
    assert.strictEqual(await policy.classifyNestedRepository('packages/foo', dir), null);
  });
});

describe('nested-worktrees fixture: what gets left out', () => {
  test('the nested linked worktree is skipped and reported, not silently dropped', () => {
    const entry = exclusionFor(bundle, 'linked-worktree');
    assert.ok(entry, 'linked-worktree must be reported as excluded');
    assert.strictEqual(entry.reason, 'nested-worktree');
    assert.strictEqual(entry.ambiguous, false);
  });

  test('the nested clone is skipped and reported under its own reason', () => {
    const entry = exclusionFor(bundle, 'third-party/tool');
    assert.ok(entry, 'third-party/tool must be reported as excluded');
    assert.strictEqual(entry.reason, 'nested-repository');
    assert.strictEqual(entry.ambiguous, false);
  });

  test('nothing inside either nested repository reaches the evidence', () => {
    const values = bundle.evidence.map(e => e.value);
    // Tripwires planted only inside the nested trees.
    assert.strictEqual(values.includes('stripe'), false);
    assert.strictEqual(values.includes('twilio'), false);
    assert.strictEqual(
      bundle.evidence.some(e => e.path.startsWith('linked-worktree/') || e.path.startsWith('third-party/')),
      false,
    );
  });

  // THE regression test for issue #34: before the boundary rule, the byte
  // identical copy in linked-worktree/package.json made every one of the
  // outer repository's own components appear twice.
  test('the outer repository is counted exactly once, not once per nested copy', () => {
    const counts = componentCounts(bundle);
    assert.strictEqual(counts.outer, 1, 'the outer CLI must appear exactly once');
    assert.strictEqual(counts['src/index.js'], 1, 'the outer library entry point must appear exactly once');
    assert.strictEqual(counts.vendored, undefined, 'the vendored clone is not one of this repo\'s components');
  });

  test('the scan root is never skipped, although it is itself a linked worktree', () => {
    assert.strictEqual(exclusionFor(bundle, '.'), undefined);
    assert.strictEqual(exclusionFor(bundle, ''), undefined);
    assert.ok(bundle.evidence.length > 0, 'a root that skipped itself would scan nothing');
    assert.ok(
      bundle.evidence.some(e => e.kind === 'component' && e.value === 'outer'),
      'the outer repository must still be described',
    );
  });

  test('a directory holding a .git-named file that is not a pointer is still scanned', () => {
    assert.strictEqual(exclusionFor(bundle, 'notes'), undefined, 'the name alone must not skip a directory');
    assert.ok(
      bundle.evidence.some(e => e.path.startsWith('notes/')),
      'notes/ must still contribute evidence',
    );
    assert.ok(
      bundle.evidence.some(e => e.kind === 'component' && e.value === 'notes'),
      'the component declared under notes/ must survive',
    );
  });
});
