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
// CLI: node scripts/eval-results-guard.js results.json

const LIMIT_STOP = /Reached maximum number of turns|timed out after \d+\s*s/i;
const TURN_LIMIT = /Reached maximum number of turns \((\d+)\)/i;

function findProblems(results) {
  const cases = (results && Array.isArray(results.cases)) ? results.cases : [];
  if (cases.length === 0) {
    return { fatal: ['results.json has zero cases: no eval ran, so there is nothing to trust.'], tolerated: [] };
  }
  const fatal = [];
  const tolerated = [];
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
        fatal.push(`${where}: ${msg}`);
      });
    }
  }
  return { fatal, tolerated };
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
  const { fatal, tolerated } = findProblems(results);
  tolerated.forEach(line => console.log(`note: stopped at its own case limit -- ${line}`));
  if (fatal.length) {
    console.log(`::error::${fatal.length} eval problem(s); their scores are not evidence.`);
    fatal.slice(0, 20).forEach(line => console.log(line));
    process.exit(1);
  }
  console.log(`No eval run failed for anything other than its own declared limit (${tolerated.length} limit-stop(s) tolerated).`);
}

module.exports = { findProblems };
