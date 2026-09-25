// Where each agent's skills go (docs/design/skills-and-plugin.md,
// "skills install"). `homeDir` is always passed in by the caller -- it
// comes from `os.homedir()` in production (src/cli/skills.js) and from a
// temp directory in every test, per this brief's safety rule: never touch
// the real home directory.

const path = require('path');

const AGENTS = ['codex', 'copilot', 'cursor'];

// Relative to the chosen base (a --project directory, or the user's home
// directory when there is no --project and the agent supports one).
const AGENT_SEGMENTS = {
  codex: ['.agents', 'skills'],
  // Verified from Cursor's own documentation (cursor.com/docs/skills and
  // cursor.com/help/customization/skills, checked 2026-09-25): Cursor
  // reads Agent Skills from ".cursor/skills/" (project) and
  // "~/.cursor/skills/" (user-level/global), among other locations. This
  // package writes to the Cursor-specific path rather than the
  // ".agents/skills" path it shares with Codex, so a `skills uninstall`
  // for one agent never touches what the other agent reads.
  cursor: ['.cursor', 'skills'],
  copilot: ['.github', 'skills'],
};

// Returns { root } (the directory that will directly contain each
// installed skill's own directory) or { error } (a message to print and a
// non-zero exit, never partial output).
function resolveTargetRoot(agent, projectDir, homeDir) {
  if (!AGENTS.includes(agent)) {
    return { error: `--agent must be one of: ${AGENTS.join(', ')}` };
  }
  if (agent === 'copilot' && !projectDir) {
    return {
      error:
        'copilot has no user-level skills location; pass --project <dir> ' +
        '(this installs into <dir>/.github/skills, which is where Copilot reads project skills from).',
    };
  }
  const base = projectDir || homeDir;
  return { root: path.join(base, ...AGENT_SEGMENTS[agent]) };
}

module.exports = { AGENTS, AGENT_SEGMENTS, resolveTargetRoot };
