// The two scripts the skill-evals workflow runs around `claude plugin eval`:
// scripts/select-eval-tags.js (which skills' cases a PR runs) and
// scripts/eval-results-guard.js (which run errors fail the job).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const { selectTags, SKILLS_DIR } = require('../scripts/select-eval-tags');
const { findProblems } = require('../scripts/eval-results-guard');

const SKILLS = fs
  .readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

describe('select-eval-tags', () => {
  test('a change inside one skill selects that skill', () => {
    assert.deepStrictEqual(selectTags(['skills/eval-build/SKILL.md']), { all: false, tags: ['eval-build'] });
  });

  test('eval cases select the skill their directory name starts with', () => {
    assert.deepStrictEqual(
      selectTags(['evals/grill-build-output-medusa/prompt.md', 'evals/business-map-trigger-idea-no-code/prompt.md']),
      { all: false, tags: ['business-map', 'grill-build'] }
    );
  });

  test('the Codex mirror counts as the skill', () => {
    assert.deepStrictEqual(selectTags(['.agents/skills/doc-map']), { all: false, tags: ['doc-map'] });
  });

  for (const shared of ['src/cli/check.js', 'bin/sequentdraw', 'schema/sequentdraw.schema.json', 'hooks/session-start.js', '.claude-plugin/plugin.json', 'package.json', 'package-lock.json', '.github/workflows/skill-evals.yml', 'scripts/select-eval-tags.js', 'scripts/eval-results-guard.js']) {
    test(`${shared} selects the full suite`, () => {
      assert.deepStrictEqual(selectTags(['skills/doc-map/SKILL.md', shared]), { all: true, tags: [] });
    });
  }

  test('an eval directory that names no known skill selects the full suite', () => {
    assert.deepStrictEqual(selectTags(['evals/mystery-case/prompt.md']), { all: true, tags: [] });
  });

  test('changes that touch no skill select nothing', () => {
    assert.deepStrictEqual(selectTags(['docs/SPEC.md', 'tests/foo.test.js']), { all: false, tags: [] });
  });
});

describe('every eval case is tagged with the skills it exercises', () => {
  const evalsDir = path.join(__dirname, '..', 'evals');
  const cases = fs.readdirSync(evalsDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'results' && e.name !== 'mocks');
  for (const entry of cases) {
    test(entry.name, () => {
      const dir = path.join(evalsDir, entry.name);
      const prompt = fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8');
      const front = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(prompt)[1]);
      const tags = new Set(front.tags || []);
      const owner = SKILLS.find(s => entry.name.startsWith(`${s}-`));
      assert.ok(owner, `${entry.name} does not start with a skill name`);
      assert.ok(tags.has(owner), `${entry.name} must be tagged ${owner}`);
      for (const file of fs.readdirSync(path.join(dir, 'graders'))) {
        const grader = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, 'graders', file), 'utf8'))[1]);
        if (grader.type === 'tool_used' && grader.tool === 'Skill') {
          assert.ok(tags.has(grader.input_match), `${entry.name} grades ${grader.input_match} and must be tagged with it`);
        }
      }
    });
  }
});

describe('eval-results-guard', () => {
  const graders = max => [{ config: { type: 'tool_used', max } }];
  const run = (turns, error) => ({ turns, error });

  test('zero cases is a failure', () => {
    assert.match(findProblems({ cases: [] }).fatal[0], /zero cases/);
    assert.match(findProblems({}).fatal[0], /zero cases/);
  });

  test('a limit stop in an ordinary case is tolerated', () => {
    const r = findProblems({ cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(9, 'exit 1: Reached maximum number of turns (8)'), run(12, 'timed out after 900s')] } }] });
    assert.deepStrictEqual(r.fatal, []);
    assert.strictEqual(r.tolerated.length, 2);
  });

  test('in a must-not-fire case a turn limit is tolerated only when the run used every turn', () => {
    const full = findProblems({ cases: [{ name: 'c', graders: graders(0), arms: { with: [run(21, 'exit 1: Reached maximum number of turns (20)')] } }] });
    assert.deepStrictEqual(full.fatal, []);
    const short = findProblems({ cases: [{ name: 'c', graders: graders(0), arms: { with: [run(3, 'exit 1: Reached maximum number of turns (20)')] } }] });
    assert.strictEqual(short.fatal.length, 1);
  });

  test('in a must-not-fire case a timeout or any other error stays fatal', () => {
    const r = findProblems({ cases: [{ name: 'c', graders: graders(0), arms: { with: [run(30, 'timed out after 600s'), run(1, "You've hit your session limit")] } }] });
    assert.strictEqual(r.fatal.length, 2);
  });

  test('a run that never took a turn is fatal anywhere', () => {
    const r = findProblems({ cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(0, 'Reached maximum number of turns (8)')] } }] });
    assert.strictEqual(r.fatal.length, 1);
  });
});
