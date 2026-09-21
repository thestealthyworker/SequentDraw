#!/usr/bin/env node
// Fails the skill-evals job when a run's score is not evidence.
//
// A run that never really executed -- a rejected credential, a sandbox that
// would not start, a plan usage limit -- scores as a pass on every "must not
// trigger" grader, because a skill that never ran also never fired.
//
// Tolerated, anywhere except a must-not-fire case: a run that took at least
// one turn and then stopped at its own case limit ("Reached maximum number
// of turns (N)" or "timed out after Ns"). Trigger-only cases are graded on
// their first turn and keep working until the limit.
//
// In a must-not-fire case (a grader with max: 0) any error is fatal, with one
// exception: "Reached maximum number of turns (N)" when the run's turn count
// is at least N. That proves a full, real run -- the other skill fired and
// kept working -- not one that died early. A timeout there stays fatal.
//
// A results file with zero cases is fatal too: nothing ran.
//
// INCONCLUSIVE is a third outcome, separate from both of those (issue #68).
// When the account's plan limit is reached mid-suite, every run after it
// dies with "You've hit your session limit", and the job reports a failure
// indistinguishable from a regression: on PR #67, eight of nine failing
// cases were that error and nothing else. Reading the artifact to find out
// costs a person twenty minutes, and the reflex it teaches -- "the evals are
// flaky, merge anyway" -- is exactly the wrong one to learn.
//
// So a run that never started for an account or infrastructure reason is
// reported as INCONCLUSIVE, with exit code 2 and wording that says the run
// proved nothing about the product. It is still not a pass: a PR cannot
// merge on evidence that does not exist. It just must not be mistaken for
// evidence of a defect.
//
// CLI: node scripts/eval-results-guard.js results.json
//   exit 0  every run is evidence
//   exit 1  a run failed for a reason that is about this PR
//   exit 2  the suite could not run; no verdict either way

const LIMIT_STOP = /Reached maximum number of turns|timed out after \d+\s*s/i;
const TURN_LIMIT = /Reached maximum number of turns \((\d+)\)/i;

// Errors that say "this account or this runner could not do the work",
// never "this change is wrong". Matched on the text the runner surfaces
// verbatim from the API.
const INCONCLUSIVE = [
  /hit your (?:session|usage) limit/i,
  /rate[_ -]?limit/i,
  /\b429\b/,
  /quota (?:exceeded|exhausted)/i,
  /(?:invalid|expired|revoked) (?:bearer )?token/i,
  /credit balance is too low/i,
  /\b5\d\d\b (?:error|status)/i,
  /overloaded/i,
];

function isInconclusive(message) {
  return INCONCLUSIVE.some(re => re.test(message));
}

function findProblems(results) {
  const cases = (results && Array.isArray(results.cases)) ? results.cases : [];
  if (cases.length === 0) {
    return { fatal: ['results.json has zero cases: no eval ran, so there is nothing to trust.'], tolerated: [] };
  }
  const fatal = [];
  const tolerated = [];
  const inconclusive = [];
  for (const c of cases) {
    const mustNotTrigger = (c.graders || []).some(g => g && g.config && g.config.max === 0);
    for (const [arm, runs] of Object.entries(c.arms || {})) {
      (runs || []).forEach((run, i) => {
        if (!run || !run.error) return;
        const turns = Number(run.turns);
        const where = `${c.name} [${arm}.${i}] turns=${run.turns}`;
        const msg = String(run.error).slice(0, 200);
        const ranAtLeastOneTurn = turns > 0;
        if (!mustNotTrigger && ranAtLeastOneTurn && LIMIT_STOP.test(msg)) {
          tolerated.push(`${where}: ${msg}`);
          return;
        }
        const limit = TURN_LIMIT.exec(msg);
        if (mustNotTrigger && limit && turns >= Number(limit[1])) {
          tolerated.push(`${where}: ${msg} (must-not-fire case; used every turn)`);
          return;
        }
        // Checked after the case-limit branches on purpose: a run that did
        // its work and then stopped at its own declared limit is tolerated
        // whatever the wording, and only a run that never got to do its
        // work is inconclusive.
        if (isInconclusive(msg)) {
          inconclusive.push(`${where}: ${msg}`);
          return;
        }
        fatal.push(`${where}: ${msg}`);
      });
    }
  }
  return { fatal, tolerated, inconclusive };
}

if (require.main === module) {
  const file = process.argv[2] || 'results.json';
  let results;
  try {
    results = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`::error::could not read ${file}: ${err.message}`);
    process.exit(1);
  }
  const { fatal, tolerated, inconclusive } = findProblems(results);
  tolerated.forEach(line => console.log(`note: stopped at its own case limit -- ${line}`));

  if (fatal.length) {
    console.log(`::error::${fatal.length} eval problem(s); their scores are not evidence.`);
    fatal.slice(0, 20).forEach(line => console.log(line));
    if (inconclusive.length) {
      console.log(`::notice::${inconclusive.length} further run(s) never started (account or infrastructure); those are not evidence either.`);
      inconclusive.slice(0, 20).forEach(line => console.log(line));
    }
    process.exit(1);
  }

  if (inconclusive.length) {
    console.log(
      `::error::INCONCLUSIVE: ${inconclusive.length} eval run(s) never started, for an account or infrastructure reason. This is NOT a product failure and NOT a regression -- the suite did not get to judge this change. Re-run the job once the limit resets; do not merge on this result either way.`,
    );
    inconclusive.slice(0, 20).forEach(line => console.log(line));
    process.exit(2);
  }

  console.log(`No eval run failed for anything other than its own declared limit (${tolerated.length} limit-stop(s) tolerated).`);
}

module.exports = { findProblems };
