#!/usr/bin/env node
// Keeps .agents/skills/<name> in sync with skills/<name> for Codex (which
// reads SKILL.md from .agents/skills/ -- docs/design/skills-and-plugin.md,
// "Packaging: one source, many agents").
//
// `skills/` is the single source of truth for every agent. The preferred
// sync mechanism is a relative symlink (`.agents/skills/<name> ->
// ../../skills/<name>`), verified in this repo to work cleanly with both
// `claude plugin validate` and `npm pack --dry-run` (neither is confused by
// it, and `.agents/` is outside the npm `files` whitelist regardless, since
// Codex consumes skills directly from a git checkout, not from the npm
// package).
//
// This script exists as the documented fallback for environments where a
// symlink cannot be created (Windows checkouts without symlink support
// enabled, or after extracting a zip/tarball that does not preserve them):
// it falls back to a real recursive copy, so `.agents/skills/<name>` always
// has real content one way or the other. Safe to re-run; it removes and
// recreates each target every time, and never touches anything outside
// `.agents/skills/`.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const AGENT_SKILLS_DIR = path.join(ROOT, '.agents', 'skills');

function listSkillNames() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md')));
}

function removeExisting(target) {
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

function syncOne(name) {
  const source = path.join(SKILLS_DIR, name);
  const relativeSource = path.join('..', '..', 'skills', name);
  const target = path.join(AGENT_SKILLS_DIR, name);

  removeExisting(target);

  try {
    fs.symlinkSync(relativeSource, target, 'dir');
    return 'symlink';
  } catch (err) {
    // Symlinks unavailable (common on Windows without developer mode /
    // admin rights) — fall back to a real copy so .agents/skills/<name>
    // still has usable content.
    copyRecursive(source, target);
    return 'copy';
  }
}

function main() {
  fs.mkdirSync(AGENT_SKILLS_DIR, { recursive: true });
  const names = listSkillNames();
  const results = names.map(name => ({ name, mode: syncOne(name) }));
  results.forEach(({ name, mode }) => {
    console.log(`.agents/skills/${name} -> skills/${name} (${mode})`);
  });
  return results;
}

if (require.main === module) {
  main();
}

module.exports = { main, listSkillNames, syncOne };
