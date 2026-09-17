#!/usr/bin/env node
// Decides which eval cases a pull request runs, from the paths it changes.
//
// Why: every eval run spends the owner's Claude plan quota, and a full suite
// ran the plan out mid-run on PR #50. A PR that only touches one skill runs
// only that skill's cases.
//
//   skills/<name>/**, .agents/skills/<name>, evals/<name>-*/**  -> that skill
//   src/, bin/, schema/, hooks/, .claude-plugin/, package*.json,
//   this script, the guard script, the eval workflow            -> full suite
//   an evals/ directory that names no known skill               -> full suite
//   anything else                                               -> nothing
//
// Cases are selected with `claude plugin eval --tag <skill...>`: every case's
// prompt.md carries a tag per skill it exercises (checked by
// tests/eval-ci-scripts.test.js). `--case` takes a single glob, so it cannot
// name several skills reliably.
//
// CLI: changed paths on stdin, one per line. Prints "all", "none", or the
// tags separated by spaces.

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

const FULL_SUITE_PREFIXES = ['src/', 'bin/', 'schema/', 'hooks/', '.claude-plugin/'];
const FULL_SUITE_FILES = new Set([
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

function selectTags(changedPaths, skills = knownSkills()) {
  const tags = new Set();
  for (const raw of changedPaths) {
    const file = raw.trim();
    if (!file) continue;
    if (FULL_SUITE_FILES.has(file) || FULL_SUITE_PREFIXES.some(p => file.startsWith(p))) {
      return { all: true, tags: [] };
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
  const input = fs.readFileSync(0, 'utf8');
  const { all, tags } = selectTags(input.split('\n'));
  process.stdout.write(`${all ? 'all' : tags.length ? tags.join(' ') : 'none'}\n`);
}

module.exports = { selectTags, SKILLS_DIR };
