// Materialises the `nested-worktrees` fixture (tests/fixtures/repos) into a
// fresh temp directory, adding the repository-boundary markers that cannot
// live in git history.
//
// Why a builder rather than a committed tree: git refuses to track any path
// containing a `.git` component. `git add` does not error on one, it silently
// ignores it -- so a committed fixture would arrive on disk missing exactly
// the markers it exists to exercise, and the tests would pass for the wrong
// reason. Everything else about the fixture IS committed and reviewable; only
// the four markers below are synthesized.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SOURCE_DIR = path.join(__dirname, 'repos', 'nested-worktrees');

// A linked worktree's marker, as `git worktree add` writes it: a regular file
// whose first line points at the real git directory.
const WORKTREE_POINTER = 'gitdir: /somewhere/else/.git/worktrees/linked\n';

// A file named `.git` that is NOT a pointer. The decoy for the rule that the
// NAME alone must never be enough to skip a directory.
const NOT_A_POINTER = '# notes about the git history, not a gitdir pointer\nref: refs/heads/main\n';

async function copyTree(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}

// Writes a plausible bare-ish git directory: enough that a human reading the
// fixture sees a real clone, though only the directory's existence is load-bearing.
async function writeGitDirectory(dir) {
  const gitDir = path.join(dir, '.git');
  await fsp.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  await fsp.mkdir(path.join(gitDir, 'objects'), { recursive: true });
  await fsp.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  await fsp.writeFile(path.join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n');
}

async function buildNestedRepoFixture(destDir) {
  await copyTree(SOURCE_DIR, destDir);

  // The scan root is itself a linked worktree -- the real SequentDraw
  // checkout is one, and a root that skipped itself would scan nothing.
  await fsp.writeFile(path.join(destDir, '.git'), WORKTREE_POINTER);

  // A nested linked worktree: `.git` is a FILE containing a gitdir pointer.
  await fsp.writeFile(path.join(destDir, 'linked-worktree', '.git'), WORKTREE_POINTER);

  // A nested clone: `.git` is a DIRECTORY.
  await writeGitDirectory(path.join(destDir, 'third-party', 'tool'));

  // The decoy: a regular file named `.git` that points at nothing.
  await fsp.writeFile(path.join(destDir, 'notes', '.git'), NOT_A_POINTER);

  return destDir;
}

async function makeTempNestedRepoFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sequentdraw-nested-'));
  await buildNestedRepoFixture(root);
  return root;
}

module.exports = { buildNestedRepoFixture, makeTempNestedRepoFixture, SOURCE_DIR };
