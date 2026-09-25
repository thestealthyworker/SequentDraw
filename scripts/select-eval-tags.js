#!/usr/bin/env node
// Decides which eval cases a pull request runs, from the paths it changes.
//
// Why: every eval run spends the owner's Claude plan quota, and a full suite
// ran the plan out mid-run on PR #50. A PR that only touches one skill runs
// only that skill's cases.
//
//   skills/<name>/**, .agents/skills/<name>, evals/<name>-*/**  -> that skill
//   hooks/, .claude-plugin/                                     -> full suite
//     (either changes how every skill triggers)
//   src/, bin/, schema/, package*.json, this script, the guard
//   script, the eval workflow                                   -> nothing,
//     unless the full-suite opt-in is set (see below)
//   an evals/ directory that names no known skill               -> full suite
//   anything else                                                -> nothing
//
// The engine paths above (src/, bin/, schema/, package*.json, the two CI
// scripts, the workflow file) used to select the full suite too. The design
// doc (docs/design/skills-and-plugin.md, "CI") only ever asked for evals on
// PRs touching skills/, evals/, hooks/ or the CLI contract; every engine PR
// (#78-#86) ran the ~65-run full suite regardless, and #86's run died on the
// plan's session limit. This brings the implementation back to the design,
// with an explicit opt-in (the PR label `run-evals`, or a manual
// workflow_dispatch run) for the engine PRs that do need full coverage --
// ones that change what the CLI prints or accepts.
//
// Cases are selected with `claude plugin eval --tag <skill...>`: every case's
// prompt.md carries a tag per skill it exercises (checked by
// tests/eval-ci-scripts.test.js). `--case` takes a single glob, so it cannot
// name several skills reliably.
//
// CLI: changed paths on stdin, one per line, plus an optional `--full` flag
// for the opt-in. Prints "all", "none", or the tags separated by spaces.
// The opt-in is passed in explicitly (a flag here, an env var in the
// workflow) rather than looked up from the GitHub API, so this script stays
// a pure function of its inputs.

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// Change how every skill triggers, so a change here always runs everything.
const FULL_SUITE_PREFIXES = ['hooks/', '.claude-plugin/'];

// The engine: it backs every skill, but does not itself change how a skill
// triggers or what a skill checks for. On its own it selects nothing; the
// full-suite opt-in is how an engine PR that does need coverage gets it.
const ENGINE_PREFIXES = ['src/', 'bin/', 'schema/'];
const ENGINE_FILES = new Set([
  'package.json',
  'package-lock.json',
  '.github/workflows/skill-evals.yml',
  'scripts/select-eval-tags.js',
  'scripts/eval-results-guard.js',
]);

function knownSkills() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    // Longest first, so a skill whose name prefixes another's cannot claim it.
    .sort((a, b) => b.length - a.length);
}

function selectTags(changedPaths, skills = knownSkills(), { fullSuiteOptIn = false } = {}) {
  // The opt-in wins outright, regardless of what changed (including nothing
  // at all -- a manual workflow_dispatch run has no diff to look at).
  if (fullSuiteOptIn) return { all: true, tags: [] };

  const tags = new Set();
  for (const raw of changedPaths) {
    const file = raw.trim();
    if (!file) continue;
    if (FULL_SUITE_PREFIXES.some(p => file.startsWith(p))) {
      return { all: true, tags: [] };
    }
    if (ENGINE_FILES.has(file) || ENGINE_PREFIXES.some(p => file.startsWith(p))) {
      // An engine path contributes nothing on its own; only the full-suite
      // opt-in (checked above) escalates it to the full suite. A skill path
      // changed in the same PR still selects that skill below.
      continue;
    }
    const skillPath = /^(?:\.agents\/)?skills\/([^/]+)/.exec(file);
    if (skillPath) {
      tags.add(skillPath[1]);
      continue;
    }
    const evalPath = /^evals\/([^/]+)/.exec(file);
    if (evalPath) {
      const owner = skills.find(s => evalPath[1].startsWith(`${s}-`));
      if (!owner) return { all: true, tags: [] };
      tags.add(owner);
    }
  }
  return { all: false, tags: [...tags].sort() };
}

if (require.main === module) {
  const fullSuiteOptIn = process.argv.slice(2).includes('--full');
  const input = fs.readFileSync(0, 'utf8');
  const { all, tags } = selectTags(input.split('\n'), undefined, { fullSuiteOptIn });
  process.stdout.write(`${all ? 'all' : tags.length ? tags.join(' ') : 'none'}\n`);
}

module.exports = { selectTags, SKILLS_DIR };
