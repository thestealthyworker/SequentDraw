// hooks/session-start.js injects the `using-sequentdraw` routing note into
// every session (docs/design/skills-and-plugin.md, "Routing context"). It
// must stay small, name every shipped skill, and never call a shipped skill
// "not shipped".

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'session-start.js');
const NOTE_CAP = 1500;

function runHook() {
  const result = spawnSync(process.execPath, [HOOK], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function shippedSkills() {
  return fs
    .readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', entry.name, 'SKILL.md')))
    .map(entry => entry.name);
}

test('the hook prints SessionStart additionalContext as JSON', () => {
  const out = runHook();
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.strictEqual(typeof out.hookSpecificOutput.additionalContext, 'string');
});

test(`the routing note stays under ${NOTE_CAP} characters`, () => {
  const note = runHook().hookSpecificOutput.additionalContext;
  assert.ok(note.length < NOTE_CAP, `routing note is ${note.length} characters`);
});

test('the routing note lists every shipped skill and calls none of them unshipped', () => {
  const note = runHook().hookSpecificOutput.additionalContext;
  for (const name of shippedSkills()) {
    assert.match(note, new RegExp(`^- ${name}: `, 'm'), `${name} is missing from the routing note`);
  }
  assert.doesNotMatch(note, /not shipped/i);
});
