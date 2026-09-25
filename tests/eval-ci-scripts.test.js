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

  // Engine paths (src/, bin/, schema/, package*.json, the selection and
  // guard scripts, the workflow itself) no longer send a PR to the full
  // suite by themselves: the design doc only ever asked for evals on PRs
  // touching skills/, evals/, hooks/ or the CLI contract, and every engine
  // PR was running the full ~65-run suite until #86 died on the plan's
  // session limit. They select nothing on their own, and contribute nothing
  // when a skill path is also touched -- the skill's own tag still selects
  // exactly that skill.
  for (const engine of ['src/cli/check.js', 'bin/sequentdraw', 'schema/sequentdraw.schema.json', 'package.json', 'package-lock.json', '.github/workflows/skill-evals.yml', 'scripts/select-eval-tags.js', 'scripts/eval-results-guard.js']) {
    test(`${engine} alone selects nothing`, () => {
      assert.deepStrictEqual(selectTags([engine]), { all: false, tags: [] });
    });

    test(`${engine} alongside a skill path selects only that skill`, () => {
      assert.deepStrictEqual(selectTags(['skills/doc-map/SKILL.md', engine]), { all: false, tags: ['doc-map'] });
    });
  }

  // hooks/ and .claude-plugin/ change how every skill triggers, so they are
  // unchanged: either one still always selects the full suite.
  for (const shared of ['hooks/session-start.js', '.claude-plugin/plugin.json']) {
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

  // The full-suite opt-in (the `run-evals` label, or a manual
  // workflow_dispatch run) always wins, whatever the changed paths say --
  // it is how an engine PR that changes the CLI contract gets real eval
  // coverage despite engine paths otherwise selecting nothing.
  test('opt-in plus an engine path selects the full suite', () => {
    assert.deepStrictEqual(selectTags(['src/cli/check.js'], undefined, { fullSuiteOptIn: true }), { all: true, tags: [] });
  });

  test('opt-in plus a skill path selects the full suite too', () => {
    assert.deepStrictEqual(selectTags(['skills/doc-map/SKILL.md'], undefined, { fullSuiteOptIn: true }), { all: true, tags: [] });
  });

  test('opt-in alone, with no changed paths, selects the full suite', () => {
    assert.deepStrictEqual(selectTags([], undefined, { fullSuiteOptIn: true }), { all: true, tags: [] });
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

  test('in a must-not-fire case a timeout stays fatal', () => {
    const r = findProblems({ cases: [{ name: 'c', graders: graders(0), arms: { with: [run(30, 'timed out after 600s')] } }] });
    assert.strictEqual(r.fatal.length, 1);
  });

  test('a run that never took a turn is fatal anywhere', () => {
    const r = findProblems({ cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(0, 'Reached maximum number of turns (8)')] } }] });
    assert.strictEqual(r.fatal.length, 1);
  });

  // Issue #68. A plan limit used to land in `fatal` beside a real defect,
  // so the job reported a failure indistinguishable from a regression: on
  // PR #67 eight of nine failing cases were that error and nothing else.
  // It is still not a pass -- a PR cannot merge on evidence that does not
  // exist -- but it must not be read as evidence of a defect either.
  test('a plan limit is inconclusive, not fatal, in an ordinary case', () => {
    const r = findProblems({
      cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(1, "exit 1: You've hit your session limit · resets 4:20am (UTC)")] } }],
    });
    assert.deepStrictEqual(r.fatal, []);
    assert.strictEqual(r.inconclusive.length, 1);
  });

  test('a plan limit is inconclusive in a must-not-fire case too', () => {
    // This is where it matters most: the skill never ran, so every
    // "must not trigger" grader passes for the wrong reason.
    const r = findProblems({
      cases: [{ name: 'c', graders: graders(0), arms: { with: [run(1, "You've hit your session limit")] } }],
    });
    assert.deepStrictEqual(r.fatal, []);
    assert.strictEqual(r.inconclusive.length, 1);
  });

  test('every account and infrastructure error is inconclusive', () => {
    for (const message of [
      "You've hit your session limit · resets 4:20am (UTC)",
      'You have hit your usage limit',
      'rate_limit exceeded',
      'HTTP 429 returned',
      'quota exhausted',
      'invalid bearer token',
      'Your credit balance is too low',
      'API overloaded, try again',
    ]) {
      const r = findProblems({ cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(1, message)] } }] });
      assert.deepStrictEqual(r.fatal, [], message);
      assert.strictEqual(r.inconclusive.length, 1, message);
    }
  });

  test('a real defect stays fatal even when a plan limit is in the same run', () => {
    // The two must not be conflated in either direction: a suite that hit
    // the limit AND found a genuine problem still reports the problem.
    const r = findProblems({
      cases: [
        { name: 'limited', graders: graders(undefined), arms: { with: [run(1, "You've hit your session limit")] } },
        { name: 'broken', graders: graders(undefined), arms: { with: [run(4, 'the skill wrote an invalid document')] } },
      ],
    });
    assert.strictEqual(r.fatal.length, 1);
    assert.match(r.fatal[0], /broken/);
    assert.strictEqual(r.inconclusive.length, 1);
  });

  test('a run that did its work and stopped at its own limit is still tolerated', () => {
    // The case-limit branches are checked BEFORE the inconclusive ones, so
    // wording that happens to mention a limit cannot demote a real run.
    const r = findProblems({
      cases: [{ name: 'c', graders: graders(undefined), arms: { with: [run(9, 'exit 1: Reached maximum number of turns (8)')] } }],
    });
    assert.strictEqual(r.tolerated.length, 1);
    assert.deepStrictEqual(r.inconclusive, []);
  });
});

// The guard is only worth having if it actually runs. `claude plugin eval`
// exits non-zero whenever cases scored under the threshold -- including
// when every one of them died on a plan limit and scored zero without
// running -- so failing the job on that step skipped the guard entirely,
// and the INCONCLUSIVE outcome could never be reached in the case it was
// written for. On PR #72, 43 runs errored, every one on the session limit,
// and the job still reported a plain red failure.
describe('the eval workflow lets the guard be the gate', () => {
  const { parse } = require('yaml');
  const workflow = parse(
    fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'skill-evals.yml'), 'utf8'),
  );
  const steps = workflow.jobs['skill-evals'].steps;
  const evalStep = steps.find(s => s.name === 'Run skill evals');
  const guardStep = steps.find(s => s.name === 'Fail on errored eval runs');

  test('the eval step does not fail the job by itself', () => {
    assert.strictEqual(evalStep['continue-on-error'], true);
    assert.strictEqual(evalStep.id, 'evals');
  });

  test('the guard runs even when the eval step failed', () => {
    assert.match(guardStep.if, /always\(\)/);
  });

  test('the guard still fails the job when the eval command failed for its own reasons', () => {
    // Otherwise continue-on-error would turn a genuine regression -- cases
    // that ran and scored badly, with no run-level error for the guard to
    // see -- into a green job.
    assert.match(guardStep.run, /steps\.evals\.outcome/);
    assert.match(guardStep.run, /exit 1/);
  });

  test('the guard step runs after the eval step', () => {
    assert.ok(steps.indexOf(guardStep) > steps.indexOf(evalStep));
  });
});

// The run-evals opt-in (brief: ci/eval-opt-in) needs the workflow to notice
// a label being added to an already-open PR, and to run on demand with no
// PR at all. Neither must ever hand the paid credential to a fork PR.
describe('the eval workflow supports the run-evals opt-in', () => {
  const rawYaml = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'skill-evals.yml'), 'utf8');
  const { parse } = require('yaml');
  const workflow = parse(rawYaml);

  test('pull_request listens for labeled events, on top of the usual ones', () => {
    assert.deepStrictEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled']);
  });

  test('the existing paths filter is kept', () => {
    assert.ok(Array.isArray(workflow.on.pull_request.paths));
    assert.ok(workflow.on.pull_request.paths.includes('src/**'));
  });

  test('workflow_dispatch is present, for a full-suite run with no PR', () => {
    assert.ok('workflow_dispatch' in workflow.on);
  });

  test('pull_request_target is never a trigger -- it would hand a fork PR the secret', () => {
    // The file's header comment names pull_request_target on purpose, to
    // explain why it is avoided, so this checks the parsed triggers rather
    // than the raw text.
    assert.ok(!('pull_request_target' in workflow.on));
  });
});
