#!/usr/bin/env node
// Static checks that run in about a second and catch the mistakes that
// otherwise cost a full skill-eval round (roughly 25 minutes of CI and a
// slice of the owner's Claude subscription usage, per run).
//
// Every check here exists because its absence actually cost a run:
//
//   * duplicate YAML keys -- a second `run:` key was added to a workflow
//     step twice in one session. GitHub rejects the file and the run dies
//     with zero steps, but `YAML.load`-style parsing accepts it silently,
//     because the last duplicate simply wins. Only walking the parse tree
//     catches it.
//   * ungrantable graders -- three doc-map cases graded "did you produce a
//     .svg" while granting only [Read, Glob, Grep, Skill]. With no Bash the
//     CLI cannot run, so the grader could never pass and was measuring the
//     tool grant rather than the skill. Two rounds lost.
//   * unreachable fixtures -- every eval run starts in an EMPTY working
//     directory, so a prompt that says "the map at examples/foo.json"
//     describes a file that is not there unless a case.yaml scaffold copies
//     it in. The agent hunts the filesystem until its turn budget is gone.
//     Two more rounds lost.
//
// No new dependencies: `yaml` is already a runtime dependency of the
// scanner. Exits 0 when clean, 1 when anything is wrong, and prints every
// problem rather than stopping at the first.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

// The tree to audit. Overridable on purpose: a checker that can only ever
// look at its own checkout can never be pointed at a known-bad tree and
// watched to FAIL, and a check that has not been seen to fail is not
// evidence of anything. While this script was being written it printed a
// confident "clean" against a tree that was supposed to be full of defects,
// and there was no way to tell a working checker from a broken one.
//   node scripts/preflight.js [tree]     or     PREFLIGHT_ROOT=<tree> npm run preflight
const ROOT = path.resolve(process.argv[2] || process.env.PREFLIGHT_ROOT || path.join(__dirname, '..'));
const problems = [];
const notes = [];

function problem(where, message) {
  problems.push(`${where}: ${message}`);
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Frontmatter is parsed with the same YAML library the scanner uses, so a
// malformed block fails here rather than deep inside a paid eval run.
function frontmatter(text) {
  if (typeof text !== 'string') return {};
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return YAML.parse(match[1]) || {};
  } catch {
    return {};
  }
}

function body(text) {
  if (typeof text !== 'string') return '';
  const match = text.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : text;
}

// ---------------------------------------------------------------- check 1
// Workflow YAML: parse errors and duplicate keys.
function checkWorkflows() {
  const dir = path.join(ROOT, '.github', 'workflows');
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f));
  } catch {
    return;
  }
  for (const file of entries) {
    const text = readIfPresent(path.join(dir, file));
    if (text == null) continue;
    // parseDocument reports "Map keys must be unique" as an error, which the
    // convenience parsers silently resolve by letting the last key win.
    const doc = YAML.parseDocument(text, { uniqueKeys: true });
    for (const err of doc.errors) {
      problem(`.github/workflows/${file}`, err.message.split('\n')[0]);
    }
  }
}

// ---------------------------------------------------------------- check 2
// Eval cases: can each grader's requirement be satisfied by the tools the
// case grants, and is every path the prompt asserts actually in the
// workspace?
const OUTPUT_TARGETS = new Set(['trace', 'files']);
const ARTIFACT_HINT = /\.(svg|html|json|png|md)\b/i;

function evalCaseDirs() {
  const evals = path.join(ROOT, 'evals');
  let entries = [];
  try {
    entries = fs.readdirSync(evals, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && e.name !== 'results' && e.name !== 'mocks')
    .map(e => path.join(evals, e.name));
}

function checkEvalCases() {
  for (const dir of evalCaseDirs()) {
    const name = path.basename(dir);
    const promptText = readIfPresent(path.join(dir, 'prompt.md'));
    const caseYamlText = readIfPresent(path.join(dir, 'case.yaml'));
    if (promptText == null && caseYamlText == null) continue;

    const promptFm = frontmatter(promptText || '');
    const caseYaml = caseYamlText ? YAML.parse(caseYamlText) || {} : {};
    const allowed = new Set(
      (promptFm.allowed_tools || (caseYaml.execution && caseYaml.execution.allowed_tools) || [])
        .map(String)
    );
    const hasBash = allowed.has('Bash');

    // -- graders vs the tool grant
    let graderFiles = [];
    try {
      graderFiles = fs
        .readdirSync(path.join(dir, 'graders'))
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(dir, 'graders', f));
    } catch {
      graderFiles = [];
    }
    for (const file of graderFiles) {
      const grader = frontmatter(readIfPresent(file) || '');
      const graderName = path.basename(file, '.md');
      const type = String(grader.type || '');
      const target = String(grader.target || 'last_message');
      const pattern = String(grader.pattern || '');

      const wantsProducedOutput =
        type === 'file_exists' ||
        (type === 'regex' && OUTPUT_TARGETS.has(target)) ||
        (type === 'regex' && ARTIFACT_HINT.test(pattern));

      if (wantsProducedOutput && !hasBash) {
        problem(
          `evals/${name}/graders/${graderName}.md`,
          `grades produced output (${type}${target ? ` on ${target}` : ''}) but the case grants ` +
            `[${[...allowed].join(', ') || 'nothing'}] -- without Bash the CLI cannot run, so this ` +
            'can never pass. Grade triggering only, or grant the tool.'
        );
      }
    }

    // -- paths the prompt claims exist
    const scaffolded = Boolean(caseYaml.context && (caseYaml.context.scaffold_script || caseYaml.context.add_dirs));
    const prompt = body(promptText || '');
    const referenced = new Set();
    for (const match of prompt.matchAll(/\b([\w.-]+(?:\/[\w.-]+)+\.\w{2,5})\b/g)) {
      referenced.add(match[1]);
    }
    for (const rel of referenced) {
      if (rel.startsWith('http')) continue;
      const existsInRepo = fs.existsSync(path.join(ROOT, rel));
      const providedByCase = fs.existsSync(path.join(dir, rel));
      if ((existsInRepo || providedByCase) && !scaffolded) {
        problem(
          `evals/${name}/prompt.md`,
          `names "${rel}", but every run starts in an EMPTY workspace and this case has no ` +
            'case.yaml scaffold_script/add_dirs to put it there. The agent will hunt for a file ' +
            'that is not present until its turn budget runs out.'
        );
      }
    }

    if (scaffolded) {
      const script = caseYaml.context && caseYaml.context.scaffold_script;
      if (script && !fs.existsSync(path.join(dir, script))) {
        problem(`evals/${name}/case.yaml`, `scaffold_script "${script}" does not exist in the case directory.`);
      }
      notes.push(`evals/${name}: scaffolded (requires --scaffold on the eval command)`);
    }
  }
}

// ---------------------------------------------------------------- check 3
// If any case scaffolds, the CI eval command must actually pass --scaffold,
// or the scaffolds silently never run.
function checkScaffoldFlag() {
  if (notes.length === 0) return;
  const wf = readIfPresent(path.join(ROOT, '.github', 'workflows', 'skill-evals.yml'));
  if (wf == null) return;
  if (!/--scaffold\b/.test(wf)) {
    problem(
      '.github/workflows/skill-evals.yml',
      `${notes.length} eval case(s) declare a scaffold_script, but the eval command does not pass ` +
        '--scaffold, so none of them will run and their fixtures will be missing.'
    );
  }
}

checkWorkflows();
checkEvalCases();
checkScaffoldFlag();

if (problems.length) {
  console.error(`preflight: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('Fix these before pushing: each one costs a full skill-eval round to discover in CI.');
  process.exit(1);
}

console.log(`preflight: clean (${notes.length} scaffolded eval case(s))`);
