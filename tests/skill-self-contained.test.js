// Skills must be self-contained for an installed user: `docs/` is not
// shipped (package.json's "files" whitelist excludes it -- see
// tests/npm-pack-exclusions.test.js), so nothing under skills/ may point
// an installed user at a repo-internal docs/ path they will not have.
// Separately, every backtick-quoted relative file reference inside
// skills/ (e.g. `references/artifact-output.md`, `scripts/sequentdraw.sh`)
// must resolve to a real file inside that same skill's directory --
// nothing points outside skills/ or at a file that does not exist.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function listMarkdownFiles(dir) {
  const out = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  walk(dir);
  return out;
}

const MARKDOWN_FILES = listMarkdownFiles(SKILLS_DIR);

// A relative file path inside a backtick span, e.g. `references/foo.md` or
// `scripts/bar.sh` -- deliberately narrow (must start with a known
// skill-local directory name) so it never matches an unrelated
// backtick-quoted code snippet or CLI flag.
const RELATIVE_REF_RE = /`((?:references|scripts|skills)\/[A-Za-z0-9_.\/-]+)`/g;

MARKDOWN_FILES.forEach(filePath => {
  const relLabel = path.relative(SKILLS_DIR, filePath);

  test(`${relLabel}: does not mention docs/`, () => {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(content, /\bdocs\//, `${relLabel} must not reference a repo-internal docs/ path`);
  });

  test(`${relLabel}: every relative file reference resolves inside skills/`, () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const skillDir = path.dirname(filePath) === SKILLS_DIR ? filePath : findSkillRoot(filePath);
    let match;
    RELATIVE_REF_RE.lastIndex = 0;
    while ((match = RELATIVE_REF_RE.exec(content))) {
      const ref = match[1];
      // A reference starting with "skills/" is skill-root-relative (as it
      // would be written from outside that skill); anything else is
      // relative to the skill's own directory.
      const resolved = ref.startsWith('skills/') ? path.join(SKILLS_DIR, '..', ref) : path.join(skillDir, ref);
      assert.ok(
        resolved.startsWith(SKILLS_DIR + path.sep),
        `${relLabel} references "${ref}", which resolves outside skills/`
      );
      assert.ok(fs.existsSync(resolved), `${relLabel} references "${ref}", which does not exist`);
    }
  });
});

function findSkillRoot(filePath) {
  // Every skill file lives at skills/<name>/... -- the skill root is the
  // first path segment under SKILLS_DIR.
  const rel = path.relative(SKILLS_DIR, filePath);
  const skillName = rel.split(path.sep)[0];
  return path.join(SKILLS_DIR, skillName);
}

test('at least one skill markdown file was checked', () => {
  assert.ok(MARKDOWN_FILES.length > 0);
});
