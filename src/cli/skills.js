// `sequentdraw skills install|uninstall|list`
//
// Copies (or removes) this package's own `skills/` into a host's skills
// location for Claude Code plugin users (docs/design/skills-and-plugin.md,
// "skills install"), so nobody has to maintain a per-agent copy of six
// skill directories by hand.
//
// The one thing a naive copy gets wrong: every skill's own
// `references/cli-pipeline.md` resolves the engine as
// `node <plugin root>/bin/sequentdraw`, where "plugin root" is computed as
// two directories above the skill's own directory -- true only inside a
// Claude Code plugin checkout. A copy at, say, ~/.agents/skills/git-map/
// has no such plugin root, so this command rewrites that one section of
// the copy to name a working command literally
// (src/skills-install/rewrite-cli-pipeline.js). Every other file, and
// every other section of that file, is copied byte for byte.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectRuntime } = require('../skills-install/runtime');
const { AGENTS, resolveTargetRoot } = require('../skills-install/target-paths');
const { markerStatus, MARKER_FILENAME } = require('../skills-install/marker');
const { symlinkBlocksPath } = require('../skills-install/symlink-guard');
const { copySkillDir } = require('../skills-install/copy-skill');
const { listShippedSkillNames, skillSummary } = require('../skills-install/list-skills');
const { mcpSnippetFor } = require('../skills-install/mcp-snippet');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = `Usage:
  sequentdraw skills install --agent <codex|copilot|cursor> [--project <dir>] [--dry-run]
  sequentdraw skills uninstall --agent <codex|copilot|cursor> [--project <dir>] [--dry-run]
  sequentdraw skills list`;

const HELP = `${USAGE}

Copies this package's six skills into a host's skills location, for hosts
other than Claude Code (which gets them from the plugin install instead).

  install     Copy skills/<name> to the target for --agent. A target
              directory is replaced only when it is absent or already
              carries this package's own install marker
              (${MARKER_FILENAME}); anything else is refused by name,
              left untouched, and the run exits non-zero.
  uninstall   Remove only directories that carry this package's own
              marker, and only the six skill names this package ships.
  list        Print the skills this package ships with their one-line
              purpose. Takes no other options.

Options:
  --agent <name>    codex, copilot or cursor. Required for install/uninstall.
  --project <dir>   Install into <dir> instead of the user's home
                     directory. Must already exist. Required for copilot,
                     which has no user-level skills location.
  --dry-run         Print every action; change nothing on disk.
  --help            Show this help.
`;

function flagValue(args, i) {
  const value = args[i + 1];
  if (value == null || value.startsWith('-')) return null;
  return value;
}

// Parses everything after the subcommand. Returns { agent, projectDir,
// dryRun } or null on an unknown flag / missing value -- the caller
// prints USAGE and exits 1, same contract as every other subcommand.
function parseOptions(args) {
  let agent = null;
  let projectDir = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent') {
      const value = flagValue(args, i);
      if (value == null) return null;
      agent = value;
      i++;
    } else if (arg === '--project') {
      const value = flagValue(args, i);
      if (value == null) return null;
      projectDir = value;
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      return null;
    }
  }
  return { agent, projectDir, dryRun };
}

function checkProjectDir(projectDir) {
  if (projectDir == null) return null;
  let stat;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    return `--project "${projectDir}" does not exist.`;
  }
  if (!stat.isDirectory()) return `--project "${projectDir}" is not a directory.`;
  return null;
}

// One line naming the skill and what happened to it -- shared by install
// and uninstall so a --dry-run line and its non-dry-run counterpart read
// the same way except for the leading verb.
function actionLine(verb, name, targetDir) {
  return `${verb} ${name} -> ${targetDir}\n`;
}

function runInstall(options, io) {
  const { stdout, stderr } = io;
  const targetResult = resolveTargetRoot(options.agent, options.projectDir, os.homedir());
  if (targetResult.error) {
    stderr.write(`${targetResult.error}\n`);
    return 1;
  }
  const root = targetResult.root;
  const runtime = detectRuntime(PACKAGE_ROOT);
  const skillNames = listShippedSkillNames(PACKAGE_ROOT);

  let refused = false;
  const toInstall = [];

  for (const name of skillNames) {
    const targetDir = path.join(root, name);
    if (symlinkBlocksPath(root, targetDir)) {
      stderr.write(`refused ${name}: "${targetDir}" (or a directory above it) is a symlink; not installing through it.\n`);
      refused = true;
      continue;
    }
    const status = markerStatus(targetDir);
    if (status === 'foreign') {
      stderr.write(`refused ${name}: "${targetDir}" already exists and does not carry this package's install marker; leaving it untouched.\n`);
      refused = true;
      continue;
    }
    toInstall.push({ name, targetDir, replacing: status === 'ours' });
  }

  toInstall.forEach(({ name, targetDir, replacing }) => {
    if (options.dryRun) {
      stdout.write(actionLine(replacing ? 'would reinstall' : 'would install', name, targetDir));
      return;
    }
    if (replacing) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    copySkillDir(path.join(PACKAGE_ROOT, 'skills', name), targetDir, {
      engineInfo: runtime,
      name,
      version: runtime.version,
    });
    stdout.write(actionLine(replacing ? 'reinstalled' : 'installed', name, targetDir));
  });

  if (toInstall.length > 0) {
    // The MCP snippet always names this running copy's own bin path, even
    // under npx, where that path is temporary -- the note below tells the
    // caller to install a stable copy before relying on it.
    const binPath = path.join(runtime.packageRoot, 'bin', 'sequentdraw');
    stdout.write('\nMCP server configuration for this agent:\n\n');
    stdout.write(`${mcpSnippetFor(options.agent, binPath)}\n`);
    if (runtime.isNpx) {
      stdout.write('\n(This package is running from a temporary npx cache; run "npm install -g sequentdraw" for a stable path before wiring this into a config file.)\n');
    }
  }

  return refused ? 1 : 0;
}

function runUninstall(options, io) {
  const { stdout, stderr } = io;
  const targetResult = resolveTargetRoot(options.agent, options.projectDir, os.homedir());
  if (targetResult.error) {
    stderr.write(`${targetResult.error}\n`);
    return 1;
  }
  const root = targetResult.root;
  const skillNames = listShippedSkillNames(PACKAGE_ROOT);

  let refused = false;

  skillNames.forEach(name => {
    const targetDir = path.join(root, name);

    if (symlinkBlocksPath(root, targetDir)) {
      stderr.write(`refused ${name}: "${targetDir}" (or a directory above it) is a symlink; not removing through it.\n`);
      refused = true;
      return;
    }
    const status = markerStatus(targetDir);
    if (status === 'absent') return; // nothing installed for this skill; nothing to report
    if (status === 'foreign') {
      stderr.write(`refused ${name}: "${targetDir}" does not carry this package's install marker; leaving it untouched.\n`);
      refused = true;
      return;
    }
    if (options.dryRun) {
      stdout.write(actionLine('would remove', name, targetDir));
      return;
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
    stdout.write(actionLine('removed', name, targetDir));
  });

  return refused ? 1 : 0;
}

function runList(io) {
  const { stdout } = io;
  listShippedSkillNames(PACKAGE_ROOT).forEach(name => {
    stdout.write(`${name}  ${skillSummary(PACKAGE_ROOT, name)}\n`);
  });
  return 0;
}

async function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(HELP);
    return 0;
  }

  const [subcommand, ...rest] = args;
  if (subcommand === 'list') {
    if (rest.length > 0) {
      stderr.write(`${USAGE}\n`);
      return 1;
    }
    return runList({ stdout, stderr });
  }

  if (subcommand !== 'install' && subcommand !== 'uninstall') {
    stderr.write(`${USAGE}\n`);
    return 1;
  }

  const options = parseOptions(rest);
  if (!options) {
    stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (!options.agent) {
    stderr.write(`--agent is required.\n${USAGE}\n`);
    return 1;
  }
  if (!AGENTS.includes(options.agent)) {
    stderr.write(`--agent must be one of: ${AGENTS.join(', ')}\n`);
    return 1;
  }
  const projectError = checkProjectDir(options.projectDir);
  if (projectError) {
    stderr.write(`${projectError}\n`);
    return 1;
  }

  return subcommand === 'install'
    ? runInstall(options, { stdout, stderr })
    : runUninstall(options, { stdout, stderr });
}

module.exports = { run, parseOptions, checkProjectDir, USAGE, HELP, PACKAGE_ROOT };
