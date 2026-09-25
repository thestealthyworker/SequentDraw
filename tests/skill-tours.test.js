// business-map and git-map are the two skills that build a map, so they are
// the two skills that can offer and write a tour (owner, 2026-09-25: no
// dedicated tour skill -- see docs/design/skills-and-plugin.md). They share
// the tour rules -- step shape, limits, the patch example -- through one
// reference file, kept byte-identical exactly as references/cli-pipeline.md
// is (tests/skill-cli-pipeline.test.js), so a fix to one reaches both.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const TOUR_SKILLS = ['business-map', 'git-map'];

test('business-map and git-map ship the same references/tours.md', () => {
  const copies = TOUR_SKILLS.map(name =>
    fs.readFileSync(path.join(SKILLS_DIR, name, 'references', 'tours.md'), 'utf8')
  );
  copies.forEach((copy, i) => {
    assert.strictEqual(
      copy,
      copies[0],
      `skills/${TOUR_SKILLS[i]}/references/tours.md differs from skills/${TOUR_SKILLS[0]}'s`
    );
  });
});

test('tours.md is not shipped by a skill that does not build a map', () => {
  const otherSkills = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !TOUR_SKILLS.includes(name));
  otherSkills.forEach(name => {
    assert.strictEqual(
      fs.existsSync(path.join(SKILLS_DIR, name, 'references', 'tours.md')),
      false,
      `skills/${name} should not ship references/tours.md`
    );
  });
});
