// Codex reads skills from .agents/skills/ (docs/design/skills-and-plugin.md,
// "Packaging: one source, many agents"). skills/ is the single source of
// truth; .agents/skills/<name> is kept in sync with it -- by a relative
// symlink where the platform supports one (verified elsewhere in this repo
// to work cleanly with both `claude plugin validate` and `npm pack
// --dry-run`), or by scripts/sync-agent-skills.js's recursive-copy fallback
// where it does not. This test asserts the two trees agree on content
// regardless of which mechanism produced .agents/skills, and that the sync
// script is idempotent and self-healing.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const AGENT_SKILLS_DIR = path.join(ROOT, '.agents', 'skills');

const { main, listSkillNames } = require('../scripts/sync-agent-skills');

function readAllFiles(dir) {
  const out = new Map();
  function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        out.set(relPath, fs.readFileSync(abs, 'utf8'));
      }
    }
  }
  walk(dir, '');
  return out;
}

test('every skills/<name>/SKILL.md has an .agents/skills/<name> counterpart with identical content', () => {
  main(); // idempotent: safe to (re)run before asserting
  const names = listSkillNames();
  assert.ok(names.includes('doc-map'));
  assert.ok(names.includes('git-map'));

  names.forEach(name => {
    const sourceDir = path.join(SKILLS_DIR, name);
    const targetDir = path.join(AGENT_SKILLS_DIR, name);
    assert.ok(fs.existsSync(targetDir), `.agents/skills/${name} should exist`);

    const sourceFiles = readAllFiles(sourceDir);
    const targetFiles = readAllFiles(targetDir);
    assert.deepStrictEqual(
      [...targetFiles.keys()].sort(),
      [...sourceFiles.keys()].sort(),
      `.agents/skills/${name} should have the same files as skills/${name}`
    );
    sourceFiles.forEach((content, relPath) => {
      assert.strictEqual(targetFiles.get(relPath), content, `${relPath} content should match`);
    });
  });
});

test('sync-agent-skills is idempotent: running it twice yields the same result', () => {
  const first = main();
  const second = main();
  assert.deepStrictEqual(second, first);
});
