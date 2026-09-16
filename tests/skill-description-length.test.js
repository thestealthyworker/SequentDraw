// Claude Code caps a skill's `description` plus `when_to_use` at 1,536
// characters combined; anything beyond is truncated (docs/design/
// skills-and-plugin.md, "How triggering actually works"). This test parses
// each skill's SKILL.md frontmatter directly (no YAML dependency needed for
// this flat, single-line-value frontmatter) and asserts the combined length
// stays under the cap, plus a couple of structural sanity checks the CI
// `plugin-validate` job also relies on (docs/design/skills-and-plugin.md,
// "Boundaries": every description states what the skill is NOT for).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DESCRIPTION_CAP = 1536;
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function parseFrontmatter(skillMdPath) {
  const raw = fs.readFileSync(skillMdPath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  assert.ok(match, `${skillMdPath} must start with a --- frontmatter block`);
  const block = match[1];

  // Frontmatter here is flat (no nested YAML) -- each top-level key starts
  // at column 0 as "key: value" and its value runs until the next
  // column-0 "key:" line. Splitting on that boundary avoids needing a YAML
  // parser for values that themselves contain colons (e.g. a URL in the
  // description text).
  const lines = block.split('\n');
  const fields = {};
  let currentKey = null;
  let currentLines = [];
  const flush = () => {
    if (currentKey) fields[currentKey] = currentLines.join('\n').trim();
  };
  for (const line of lines) {
    const keyMatch = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1];
      currentLines = [keyMatch[2]];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return fields;
}

function listSkillDirs() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md')));
}

listSkillDirs().forEach(name => {
  const skillMdPath = path.join(SKILLS_DIR, name, 'SKILL.md');

  test(`${name}: description + when_to_use is at or under ${DESCRIPTION_CAP} chars`, () => {
    const fields = parseFrontmatter(skillMdPath);
    assert.ok(fields.description, `${name} SKILL.md must have a description`);
    const combined = (fields.description || '') + (fields.when_to_use || '');
    assert.ok(
      combined.length <= DESCRIPTION_CAP,
      `${name}: description + when_to_use is ${combined.length} chars, over the ${DESCRIPTION_CAP} cap`
    );
  });

  test(`${name}: name matches its directory`, () => {
    const fields = parseFrontmatter(skillMdPath);
    assert.strictEqual(fields.name, name);
  });

  test(`${name}: description states what the skill is NOT for`, () => {
    const fields = parseFrontmatter(skillMdPath);
    assert.match(fields.description, /\bNOT\b/, `${name}'s description should say what it is not for`);
  });
});
